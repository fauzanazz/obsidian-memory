# Hybrid Search + Save-Session Event Wiring

## Context

Wave 1 created two foundational modules: `embeddings.ts` (vector search engine) and `event-extractor.ts` (temporal event extraction). This task wires them into the existing CLI commands:

1. **Upgrade `search`** — Replace the two-provider system (`ObsidianSearchProvider` vs `HybridSearchProvider`) with a unified hybrid search that always uses keyword + vector (when available), fused via reciprocal rank fusion.

2. **Wire `save-session`** — After saving a session note, extract events into `events.jsonl` and add the note to the embedding index. Both are best-effort (skip silently if no API key).

This task assumes `src/lib/embeddings.ts` and `src/lib/event-extractor.ts` exist from FAU-57 and FAU-58.

## Requirements

- `search` command uses hybrid retrieval (keyword + vector) when GEMINI_API_KEY is available
- `search` command falls back to keyword-only when no API key (current behavior, unchanged)
- Search results show which sources contributed (keyword, vector, or both)
- `save-session` extracts events and appends to `events.jsonl` after saving the note
- `save-session` adds the new note to the embedding index after saving
- Both event extraction and embedding are fire-and-forget: errors are logged but don't fail the save
- No new npm dependencies

## Implementation

### 1. Upgrade the search provider system

**File:** `src/lib/search.ts`

Replace the current two-class provider system with a unified hybrid provider that combines keyword (Obsidian CLI) and vector (built-in embeddings):

```typescript
import { ObsidianCLI, type SearchResult } from "./obsidian-cli";
import {
  vectorSearch, reciprocalRankFusion,
  type VectorSearchResult, type FusedSearchResult,
} from "./embeddings";

export interface SearchProvider {
  search(query: string, options?: { path?: string; limit?: number }): Promise<SearchResult[]>;
  name: string;
}

export interface HybridSearchResult extends SearchResult {
  score?: number;
  sources?: Array<"keyword" | "vector">;
}

export class ObsidianSearchProvider implements SearchProvider {
  readonly name = "obsidian-cli";
  constructor(private cli: ObsidianCLI) {}

  async search(
    query: string,
    options?: { path?: string; limit?: number },
  ): Promise<SearchResult[]> {
    return this.cli.search(query, options);
  }
}

/**
 * Unified hybrid search provider.
 * Combines Obsidian CLI keyword search with built-in vector search.
 * Falls back to keyword-only if vector search is unavailable.
 */
export class UnifiedHybridProvider implements SearchProvider {
  readonly name = "hybrid (keyword + vector)";

  constructor(
    private cli: ObsidianCLI,
    private vaultPath: string,
    private apiKey: string,
  ) {}

  async search(
    query: string,
    options?: { path?: string; limit?: number },
  ): Promise<HybridSearchResult[]> {
    const limit = options?.limit ?? 10;

    // Run keyword and vector search in parallel
    const [keywordResults, vectorResults] = await Promise.all([
      this.cli.search(query, options).catch(() => [] as SearchResult[]),
      vectorSearch(this.vaultPath, query, this.apiKey, limit * 2).catch(
        () => [] as VectorSearchResult[],
      ),
    ]);

    // Filter vector results by path prefix if specified
    let filteredVector = vectorResults;
    if (options?.path) {
      filteredVector = vectorResults.filter((r) =>
        r.path.startsWith(options.path!),
      );
    }

    // Fuse results
    const fused = reciprocalRankFusion(
      keywordResults.map((r) => r.path),
      filteredVector,
    );

    // Convert to HybridSearchResult
    return fused.slice(0, limit).map((f) => ({
      path: f.path,
      matches: keywordResults.find((k) => k.path === f.path)?.matches ?? [],
      score: f.score,
      sources: f.sources,
    }));
  }
}

/**
 * Create the appropriate search provider based on available capabilities.
 * Prefers hybrid when GEMINI_API_KEY is available, falls back to keyword-only.
 */
export async function createSearchProvider(
  cli: ObsidianCLI,
  vaultPath?: string,
): Promise<SearchProvider> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && vaultPath) {
    return new UnifiedHybridProvider(cli, vaultPath, apiKey);
  }

  return new ObsidianSearchProvider(cli);
}

// Re-export for backward compatibility
export { detectHybridSearch } from "./embeddings";
```

Note: The old `HybridSearchProvider` (which shelled out to the external `obsidian-hybrid-search` binary) is removed. The new `UnifiedHybridProvider` uses the built-in embedding engine instead.

### 2. Update search command output

**File:** `src/commands/search.ts`

Update `formatSearchResults` to show source indicators:

```typescript
export function formatSearchResults(
  results: SearchResult[],
  provider: string,
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s) via ${provider}:\n`);

  for (const result of results) {
    const hybrid = result as any;
    const sourceTag = hybrid.sources
      ? ` [${hybrid.sources.join("+")}]`
      : "";
    lines.push(`  ${result.path}${sourceTag}`);
    if (result.matches?.length) {
      for (const match of result.matches.slice(0, 2)) {
        lines.push(`    > ${match}`);
      }
    }
  }

  return lines.join("\n");
}
```

### 3. Wire event extraction + embedding into save-session

**File:** `src/commands/save-session.ts`

Add imports and post-save logic:

```typescript
import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { sessionNote } from "../templates/note-templates";
import { randomBytes } from "crypto";
import { extractEvents, appendEvents, type ExtractionInput } from "../lib/event-extractor";
import { addToIndex } from "../lib/embeddings";

// ... existing SaveSessionOptions interface unchanged ...

export async function runSaveSession(
  cwd: string,
  options: SaveSessionOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first.",
    );
  }

  const { vault, project, vaultPath, llm } = found.config;
  const cli = new ObsidianCLI(vault);

  const date = new Date().toISOString().split("T")[0];
  const hash = randomBytes(3).toString("hex");
  const noteName = `Memory/Sessions/${project}/${date}-${options.agent}-${hash}`;

  const content = sessionNote({
    agent: options.agent,
    project,
    date,
    summary: options.summary,
    decisions: options.decisions,
    files: options.files,
    blockers: options.blockers,
    nextSteps: options.nextSteps,
  });

  await cli.create({
    name: noteName,
    content,
    silent: true,
  });

  // Update progress file with latest session reference (existing behavior)
  try {
    await cli.prepend({
      path: `Memory/Projects/${project}/progress.md`,
      content: `\n- ${date}: [[${date}-${options.agent}-${hash}|${options.agent} session]] — ${truncate(options.summary, 80)}\n`,
    });
  } catch {
    // Progress file may not exist yet — not critical
  }

  // --- NEW: Post-save enrichment (best-effort) ---

  const resolvedVaultPath = resolveVaultPath(found.config);
  const apiKey = process.env[llm?.apiKeyEnv ?? "GEMINI_API_KEY"];

  if (apiKey && resolvedVaultPath) {
    // Extract events and append to events.jsonl
    try {
      const input: ExtractionInput = {
        date,
        summary: options.summary,
        files: options.files,
        decisions: options.decisions,
        sessionPath: noteName + ".md",
      };
      const events = await extractEvents(input, llm);
      await appendEvents(resolvedVaultPath, project, events);
    } catch (err) {
      // Fire-and-forget: log but don't fail the save
      console.error(`[save-session] Event extraction failed: ${err instanceof Error ? err.message : err}`);
    }

    // Add session note to embedding index
    try {
      await addToIndex(resolvedVaultPath, {
        path: noteName + ".md",
        content,
      }, apiKey);
    } catch (err) {
      console.error(`[save-session] Embedding failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return noteName;
}

/**
 * Resolve the vault filesystem path from config.
 * Tries config.vaultPath first, then standard Obsidian locations.
 */
function resolveVaultPath(config: { vault: string; vaultPath?: string }): string | null {
  if (config.vaultPath) {
    const resolved = config.vaultPath.replace(/^~/, process.env.HOME || "~");
    return resolved;
  }

  // Try standard Obsidian vault locations
  const home = process.env.HOME || "~";
  const candidates = [
    `${home}/Documents/${config.vault}`,
    `${home}/${config.vault}`,
    `${home}/Obsidian/${config.vault}`,
  ];

  for (const candidate of candidates) {
    if (Bun.file(candidate + "/Memory").size > 0) {
      return candidate;
    }
  }

  return null;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
```

### 4. Resolve vault path in search command

**File:** `src/commands/search.ts`

The `createSearchProvider` now needs vaultPath. Update the search command to resolve it:

```typescript
export async function runSearch(
  cwd: string,
  query: string,
  options?: SearchCommandOptions,
): Promise<{ results: SearchResult[]; provider: string }> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first.",
    );
  }

  const { vault, vaultPath } = found.config;
  const cli = new ObsidianCLI(vault);

  // Resolve vault filesystem path for hybrid search
  const resolvedPath = resolveVaultPath(found.config);

  const provider = await createSearchProvider(cli, resolvedPath ?? undefined);

  const results = await provider.search(query, {
    path: options?.path || "Memory/",
    limit: options?.limit,
  });

  return { results, provider: provider.name };
}

function resolveVaultPath(config: { vault: string; vaultPath?: string }): string | null {
  if (config.vaultPath) {
    return config.vaultPath.replace(/^~/, process.env.HOME || "~");
  }
  const home = process.env.HOME || "~";
  const candidates = [
    `${home}/Documents/${config.vault}`,
    `${home}/${config.vault}`,
    `${home}/Obsidian/${config.vault}`,
  ];
  for (const candidate of candidates) {
    try {
      // Check if Memory/ folder exists
      if (Bun.file(candidate + "/Memory/Index.md").size > 0) return candidate;
    } catch {}
  }
  return null;
}
```

## Testing Strategy

**File:** `tests/commands/save-session.test.ts`

Extend existing tests to verify event extraction and embedding are called:

```typescript
describe("save-session with events", () => {
  test("extracts events when GEMINI_API_KEY is set", async () => {
    // Mock extractEvents and addToIndex
    // Verify they're called with correct arguments
    // Verify save-session still returns the note name even if extraction fails
  });

  test("skips event extraction when no API key", async () => {
    // Remove GEMINI_API_KEY from env
    // Verify save-session works normally without events
  });

  test("save-session succeeds even if event extraction throws", async () => {
    // Mock extractEvents to throw
    // Verify save-session still completes successfully
  });
});
```

**File:** `tests/unit/search-hybrid.test.ts` (new)

```typescript
describe("UnifiedHybridProvider", () => {
  test("fuses keyword and vector results", async () => {
    // Mock CLI search and vectorSearch
    // Verify results are fused via RRF
    // Verify source tags are present
  });

  test("falls back to keyword-only when vector search fails", async () => {
    // Mock vectorSearch to throw
    // Verify keyword results are still returned
  });
});
```

**Commands:**
```bash
bun test
bunx tsc --noEmit
```

## Out of Scope

- Task-aware context loading (Wave 3)
- Timeline/query commands (Wave 3)
- Bulk re-indexing of existing sessions (users can delete index.json to rebuild)
- The old `HybridSearchProvider` (external binary) — removed in favor of built-in
- Event extraction for maintain --enrich (can be added later)
- Embedding events from events.jsonl (only session notes are embedded for now)
