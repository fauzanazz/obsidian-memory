# Task-Aware Context Loading + Temporal Query Commands

## Context

Waves 1-2 created the infrastructure: `embeddings.ts` (vector search), `event-extractor.ts` (structured events), hybrid search, and save-session wiring. This final wave builds the user-facing intelligence on top:

1. **Task-aware `load-context --task`** — Generates LLM retrieval guidance from a task description, then assembles a focused context package using hybrid search over events + sessions.

2. **Timeline command** — `obsidian-memory timeline` lists events from the event index chronologically with date-range filters.

3. **Query command** — `obsidian-memory query "what changed in auth?" --since 2026-03-01` combines temporal event filtering with keyword search and returns events + linked sessions.

This task assumes `src/lib/embeddings.ts`, `src/lib/event-extractor.ts`, and the hybrid search provider from FAU-57, FAU-58, FAU-59 all exist.

## Requirements

- New `--task <description>` flag on `load-context` that triggers dynamic retrieval
- Dynamic retrieval: LLM generates retrieval guidance keywords → hybrid search events + sessions → assemble context
- New `timeline` command with `--last <duration>`, `--since <date>`, `--until <date>`, `--project <name>` flags
- New `query <text>` command with `--since <date>`, `--until <date>` flags that searches events + retrieves linked sessions
- Graceful degradation: `--task` falls back to `--default` tier when no GEMINI_API_KEY
- All existing `load-context` tiers unchanged (minimal, default, focus, full)
- No new npm dependencies

## Implementation

### 1. Add task-aware tier to load-context

**File:** `src/commands/load-context.ts`

Add the `"task"` tier and its implementation.

Update the `LoadContextTier` type:

```typescript
export type LoadContextTier = "minimal" | "default" | "focus" | "full" | "task";
```

Add `taskDescription` to `LoadContextOptions`:

```typescript
export interface LoadContextOptions {
  tier?: LoadContextTier;
  focus?: string;
  taskDescription?: string; // NEW: for task-aware mode
  includeConventions?: boolean;
  includeDecisions?: boolean;
  includeSessions?: number;
}
```

Add the task-aware loader function:

```typescript
import { callLLMJson } from "../lib/llm";
import { vectorSearch, reciprocalRankFusion } from "../lib/embeddings";
import { readEvents, searchEvents, formatEventTimeline } from "../lib/event-extractor";

// ---------------------------------------------------------------------------
// Task-aware tier: dynamic retrieval guidance + hybrid search
// ---------------------------------------------------------------------------

const RETRIEVAL_GUIDANCE_PROMPT = `You are a retrieval guidance generator for a coding project's memory system.

Given a task description, generate search keywords and topics that should be used to find relevant context from the project's memory vault (session notes, decisions, events, documentation).

## Task Description
{TASK}

---

Return a JSON object:
{
  "keywords": ["3-5 specific search keywords/phrases relevant to this task"],
  "topics": ["2-3 broader topic areas to search"],
  "timeframe": "recent|all" // "recent" if task is likely about current work, "all" for historical
}

Rules:
- Keywords should be concrete technical terms (function names, module names, patterns)
- Topics should be broader domain areas (authentication, database, testing)
- Return ONLY valid JSON, no markdown fences`;

interface RetrievalGuidance {
  keywords: string[];
  topics: string[];
  timeframe: "recent" | "all";
}

async function loadTaskAware(
  cli: ObsidianCLI,
  project: string,
  vaultPath: string,
  taskDescription: string,
  sections: string[],
  opts: Required<Omit<LoadContextOptions, "focus" | "taskDescription">>,
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Fallback to default tier
    await loadTier2(cli, project, sections, opts);
    return;
  }

  // Step 1: Generate retrieval guidance
  let guidance: RetrievalGuidance;
  try {
    const prompt = RETRIEVAL_GUIDANCE_PROMPT.replace("{TASK}", taskDescription);
    guidance = await callLLMJson<RetrievalGuidance>(prompt);
  } catch {
    // Fallback if LLM fails
    guidance = {
      keywords: taskDescription.split(/\s+/).slice(0, 5),
      topics: [],
      timeframe: "recent",
    };
  }

  // Step 2: Search events by guided keywords
  const allEvents = await readEvents(vaultPath, project, {
    since: guidance.timeframe === "recent"
      ? new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0]
      : undefined,
  });

  const allQueryTerms = [...guidance.keywords, ...guidance.topics].join(" ");
  const relevantEvents = searchEvents(allEvents, allQueryTerms);

  if (relevantEvents.length > 0) {
    const eventSection = formatEventTimeline(relevantEvents.slice(0, 10));
    sections.push(`## Relevant Events\n\n${eventSection}`);
  }

  // Step 3: Hybrid search sessions using guided queries
  const searchQueries = [taskDescription, ...guidance.keywords.slice(0, 2)];
  const sessionPaths = new Set<string>();

  for (const query of searchQueries) {
    try {
      // Vector search
      const vectorResults = await vectorSearch(vaultPath, query, apiKey, 5);

      // Keyword search via CLI
      const keywordResults = await cli.search(query, {
        path: `Memory/Sessions/${project}/`,
        limit: 5,
      });

      // Fuse
      const fused = reciprocalRankFusion(
        keywordResults.map((r) => r.path),
        vectorResults,
      );

      for (const result of fused.slice(0, 3)) {
        sessionPaths.add(result.path);
      }
    } catch {
      // Continue with other queries
    }
  }

  // Also add sessions referenced by relevant events
  for (const event of relevantEvents.slice(0, 5)) {
    if (event.source) sessionPaths.add(event.source);
  }

  // Step 4: Load matched session content
  if (sessionPaths.size > 0) {
    const sessionSections: string[] = [];
    for (const path of Array.from(sessionPaths).slice(0, 5)) {
      try {
        const content = await cli.read({ path });
        const summary = extractSection(content, "Summary");
        const decisions = extractSection(content, "Decisions Made");
        const filename = path.split("/").pop() || "";

        const parts: string[] = [`### ${filename}`];
        if (summary) parts.push(summary.trim());
        if (decisions) parts.push(`**Decisions:** ${decisions.trim()}`);
        sessionSections.push(parts.join("\n"));
      } catch {}
    }

    if (sessionSections.length > 0) {
      sections.push(
        `## Relevant Sessions (${sessionSections.length} found)\n\n` +
        sessionSections.join("\n\n---\n\n"),
      );
    }
  }

  // Step 5: Also load decisions (always useful context)
  if (opts.includeDecisions) {
    try {
      const decisionsDoc = await cli.read({
        path: `Memory/Projects/${project}/decisions.md`,
      });
      const adrLinks = decisionsDoc
        .split("\n")
        .filter((line) => /^\s*-\s*\[\[ADRs\/ADR-/.test(line))
        .join("\n");
      if (adrLinks) {
        sections.push("## Decisions\n\n" + adrLinks);
      }
    } catch {}
  }

  // Step 6: Add task framing
  sections.unshift(
    `## Task Context\n\n**Task:** ${taskDescription}\n**Retrieval focus:** ${guidance.keywords.join(", ")}`,
  );
}
```

Wire into `runLoadContext`:

```typescript
export async function runLoadContext(
  cwd: string,
  options?: LoadContextOptions,
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  if (opts.focus) opts.tier = "focus";

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory.json found. Run `obsidian-memory init` first.");
  }

  const { vault, project, vaultPath: configVaultPath } = found.config;
  const cli = new ObsidianCLI(vault);
  const sections: string[] = [];

  // Tier 1: Always loaded
  await loadTier1(cli, project, sections);

  if (opts.tier === "minimal") {
    return formatOutput(project, sections);
  }

  // Task-aware tier (NEW)
  if (opts.tier === "task" && opts.taskDescription) {
    const resolvedVaultPath = resolveVaultPath(found.config);
    if (resolvedVaultPath) {
      await loadTaskAware(cli, project, resolvedVaultPath, opts.taskDescription, sections, opts);
    } else {
      // Can't resolve vault path — fall back to default tier
      await loadTier2(cli, project, sections, opts);
    }
    return formatOutput(project, sections);
  }

  // ... rest of existing tiers unchanged ...
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
      if (Bun.file(candidate + "/Memory/Index.md").size > 0) return candidate;
    } catch {}
  }
  return null;
}
```

### 2. Add --task flag to CLI

**File:** `src/index.ts`

Update the `load-context` command definition:

```typescript
program
  .command("load-context")
  .description("Load project context from the memory vault")
  .option("--minimal", "Tier 1 only: project summary, current state, blockers (~500 tokens)")
  .option("--focus <keyword>", "Load full content for notes matching keyword")
  .option("--full", "Load everything (backwards compatible)")
  .option("--task <description>", "Task-aware mode: dynamic retrieval guided by task description")  // NEW
  .option("--no-conventions", "Exclude conventions")
  .option("--no-decisions", "Exclude decisions")
  .option("--sessions <n>", "Number of recent sessions to include", "3")
  .action(async (opts) => {
    try {
      let tier: LoadContextTier = "default";
      if (opts.minimal) tier = "minimal";
      else if (opts.focus) tier = "focus";
      else if (opts.full) tier = "full";
      else if (opts.task) tier = "task";  // NEW

      const output = await runLoadContext(process.cwd(), {
        tier,
        focus: opts.focus,
        taskDescription: opts.task,  // NEW
        includeConventions: opts.conventions !== false,
        includeDecisions: opts.decisions !== false,
        includeSessions: parseInt(opts.sessions, 10),
      });
      console.log(output);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });
```

### 3. Add timeline command

**File:** `src/commands/timeline.ts` (new)

```typescript
import { findConfig } from "../lib/config";
import { readEvents, formatEventTimeline } from "../lib/event-extractor";

export interface TimelineOptions {
  last?: string;      // duration like "7d", "2w", "1m"
  since?: string;     // ISO date
  until?: string;     // ISO date
  project?: string;   // override project from config
  limit?: number;
}

function parseDuration(duration: string): string {
  const match = duration.match(/^(\d+)([dwm])$/);
  if (!match) throw new Error(`Invalid duration: ${duration}. Use format like "7d", "2w", "1m".`);

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case "d": now.setDate(now.getDate() - value); break;
    case "w": now.setDate(now.getDate() - value * 7); break;
    case "m": now.setMonth(now.getMonth() - value); break;
  }

  return now.toISOString().split("T")[0];
}

export async function runTimeline(
  cwd: string,
  options: TimelineOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory.json found. Run `obsidian-memory init` first.");
  }

  const project = options.project ?? found.config.project;
  const vaultPath = resolveVaultPath(found.config);

  if (!vaultPath) {
    throw new Error("Could not resolve vault filesystem path. Set vaultPath in .obsidian-memory.json.");
  }

  const since = options.last ? parseDuration(options.last) : options.since;
  const until = options.until;

  const events = await readEvents(vaultPath, project, { since, until });

  if (events.length === 0) {
    const rangeStr = since ? ` since ${since}` : "";
    return `No events found for project "${project}"${rangeStr}. Events are extracted during save-session when GEMINI_API_KEY is set.`;
  }

  const limited = options.limit ? events.slice(0, options.limit) : events;
  return `# Timeline — ${project}\n\n${formatEventTimeline(limited)}`;
}

function resolveVaultPath(config: { vault: string; vaultPath?: string }): string | null {
  if (config.vaultPath) {
    return config.vaultPath.replace(/^~/, process.env.HOME || "~");
  }
  const home = process.env.HOME || "~";
  for (const candidate of [
    `${home}/Documents/${config.vault}`,
    `${home}/${config.vault}`,
    `${home}/Obsidian/${config.vault}`,
  ]) {
    try {
      if (Bun.file(candidate + "/Memory/Index.md").size > 0) return candidate;
    } catch {}
  }
  return null;
}
```

### 4. Add query command

**File:** `src/commands/query.ts` (new)

```typescript
import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { readEvents, searchEvents, formatEventTimeline, type ProjectEvent } from "../lib/event-extractor";
import { vectorSearch, reciprocalRankFusion } from "../lib/embeddings";
import { extractSection } from "./load-context";

export interface QueryOptions {
  since?: string;
  until?: string;
  limit?: number;
}

export async function runQuery(
  cwd: string,
  queryText: string,
  options: QueryOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory.json found. Run `obsidian-memory init` first.");
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);
  const vaultPath = resolveVaultPath(found.config);

  if (!vaultPath) {
    throw new Error("Could not resolve vault filesystem path.");
  }

  const sections: string[] = [];
  sections.push(`# Query: "${queryText}"`);

  // 1. Search events
  const allEvents = await readEvents(vaultPath, project, {
    since: options.since,
    until: options.until,
  });
  const matchedEvents = searchEvents(allEvents, queryText);
  const limitedEvents = matchedEvents.slice(0, options.limit ?? 10);

  if (limitedEvents.length > 0) {
    sections.push(`## Matching Events (${limitedEvents.length})\n\n${formatEventTimeline(limitedEvents)}`);
  } else {
    sections.push("## Events\n\nNo matching events found.");
  }

  // 2. Find related sessions (via event sources + hybrid search)
  const sessionPaths = new Set<string>();

  // Sessions from matching events
  for (const event of limitedEvents) {
    if (event.source) sessionPaths.add(event.source);
  }

  // Hybrid search for additional sessions
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const vectorResults = await vectorSearch(vaultPath, queryText, apiKey, 5);
      const keywordResults = await cli.search(queryText, {
        path: `Memory/Sessions/${project}/`,
        limit: 5,
      });
      const fused = reciprocalRankFusion(
        keywordResults.map((r) => r.path),
        vectorResults.filter((r) => r.path.includes("Sessions/")),
      );
      for (const result of fused.slice(0, 3)) {
        sessionPaths.add(result.path);
      }
    } catch {}
  } else {
    // Keyword-only fallback
    try {
      const results = await cli.search(queryText, {
        path: `Memory/Sessions/${project}/`,
        limit: 5,
      });
      for (const r of results) sessionPaths.add(r.path);
    } catch {}
  }

  // 3. Load session summaries
  if (sessionPaths.size > 0) {
    const sessionLines: string[] = [];
    for (const path of Array.from(sessionPaths).slice(0, 5)) {
      try {
        const content = await cli.read({ path });
        const summary = extractSection(content, "Summary");
        const filename = path.split("/").pop() || "";
        sessionLines.push(`- **${filename}**: ${summary?.trim() || "No summary"}`);
      } catch {}
    }
    if (sessionLines.length > 0) {
      sections.push(`## Related Sessions\n\n${sessionLines.join("\n")}`);
    }
  }

  return sections.join("\n\n");
}

function resolveVaultPath(config: { vault: string; vaultPath?: string }): string | null {
  if (config.vaultPath) {
    return config.vaultPath.replace(/^~/, process.env.HOME || "~");
  }
  const home = process.env.HOME || "~";
  for (const candidate of [
    `${home}/Documents/${config.vault}`,
    `${home}/${config.vault}`,
    `${home}/Obsidian/${config.vault}`,
  ]) {
    try {
      if (Bun.file(candidate + "/Memory/Index.md").size > 0) return candidate;
    } catch {}
  }
  return null;
}
```

### 5. Wire new commands into CLI

**File:** `src/index.ts`

Add imports and command definitions:

```typescript
import { runTimeline, type TimelineOptions } from "./commands/timeline";
import { runQuery, type QueryOptions } from "./commands/query";

// After existing commands:

program
  .command("timeline")
  .description("Show project event timeline from the event index")
  .option("--last <duration>", "Show events from last N days/weeks/months (e.g., 7d, 2w, 1m)")
  .option("--since <date>", "Show events since date (YYYY-MM-DD)")
  .option("--until <date>", "Show events until date (YYYY-MM-DD)")
  .option("--project <name>", "Override project name from config")
  .option("--limit <n>", "Maximum number of events")
  .action(async (opts) => {
    try {
      const output = await runTimeline(process.cwd(), {
        last: opts.last,
        since: opts.since,
        until: opts.until,
        project: opts.project,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      console.log(output);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("query <text>")
  .description("Search events and sessions by keyword with optional date filtering")
  .option("--since <date>", "Filter events since date (YYYY-MM-DD)")
  .option("--until <date>", "Filter events until date (YYYY-MM-DD)")
  .option("--limit <n>", "Maximum number of results")
  .action(async (text: string, opts) => {
    try {
      const output = await runQuery(process.cwd(), text, {
        since: opts.since,
        until: opts.until,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      console.log(output);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });
```

## Testing Strategy

**File:** `tests/commands/load-context.test.ts`

Extend existing tests for the task-aware tier:

```typescript
describe("load-context --task", () => {
  test("falls back to default tier when no API key", async () => {
    // Remove GEMINI_API_KEY
    // Call runLoadContext with tier: "task"
    // Verify it returns default tier content (not empty)
  });
});
```

**File:** `tests/commands/timeline.test.ts` (new)

```typescript
describe("timeline", () => {
  test("parseDuration handles days, weeks, months", () => {
    // Test "7d", "2w", "1m" parsing
  });

  test("returns message when no events exist", async () => {
    const output = await runTimeline(cwd, { last: "7d" });
    expect(output).toContain("No events found");
  });
});
```

**File:** `tests/commands/query.test.ts` (new)

```typescript
describe("query", () => {
  test("searches events and returns formatted results", async () => {
    // Create temp events.jsonl with test data
    // Run query
    // Verify events are found and sessions are linked
  });

  test("handles no matches gracefully", async () => {
    const output = await runQuery(cwd, "nonexistent-feature", {});
    expect(output).toContain("No matching events");
  });
});
```

**Commands:**
```bash
bun test
bunx tsc --noEmit
```

## Out of Scope

- Embedding events from events.jsonl into the vector index (session notes are embedded; events are keyword-searched)
- Backfilling old sessions with events (can use maintain --enrich later)
- LLM-powered answer generation from retrieved context (just retrieve, don't synthesize)
- Updating AGENTS.md protocol with new commands (can be done separately)
- Dashboard or web UI for timeline visualization
