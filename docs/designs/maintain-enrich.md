# Post-Session Enrichment Agent via LLM

## Context

When an agent runs `save-session`, it produces a flat session note — summary, decisions as bullet strings, file list. But the vault's real value comes from structured, interlinked notes: individual feature notes (FAU-28), rich ADR notes (FAU-29), cross-linked frontmatter. Today, no automated process creates those richer artifacts from session data. The claude-orchestrator already has a pattern for this — its `memory.ts` calls Gemini Flash 2 post-run to generate session summaries and update docs. This issue brings that LLM-powered enrichment directly into obsidian-memory as a `maintain` command, so any project (not just orchestrator-managed ones) can auto-enrich sessions.

**Depends on:** FAU-28 (save-feature) and FAU-29 (save-decision) — the enrichment agent calls these functions programmatically.

## Requirements

- New `obsidian-memory maintain` command with `--enrich` subcommand
- LLM configuration via `.obsidian-memory.json` (provider, model, API key env var name)
- Reads a session note → calls LLM → extracts features, decisions, and cross-links
- Creates feature notes via `runSaveFeature()` when new features are detected
- Creates ADR notes via `runSaveDecision()` when non-trivial decisions are detected
- Updates the session note's frontmatter with `features_touched`, `decisions_made`, `topics`
- Can target a specific session (`--session <path>`) or auto-enrich the most recent unenriched session
- Idempotent: re-enriching an already-enriched session is a no-op (checks `enriched: true` frontmatter)

## Implementation

### 1. Extend config: `src/lib/config.ts`

Add optional LLM configuration to `MemoryConfig`:

```typescript
export interface LLMConfig {
  provider: "gemini" | "anthropic" | "openai";  // which API to call
  model: string;                                  // e.g. "gemini-2.0-flash"
  apiKeyEnv: string;                              // env var name, e.g. "GEMINI_API_KEY"
}

export interface MemoryConfig {
  vault: string;
  project: string;
  agents: string[];
  vaultPath?: string;
  llm?: LLMConfig;          // NEW
}
```

Default when `llm` is not set:
```json
{
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "apiKeyEnv": "GEMINI_API_KEY"
}
```

Example `.obsidian-memory.json` with LLM config:
```json
{
  "vault": "DevMemory",
  "project": "todo-app",
  "agents": ["claude-code", "cursor"],
  "llm": {
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "apiKeyEnv": "GEMINI_API_KEY"
  }
}
```

### 2. New LLM client: `src/lib/llm.ts`

Provider-agnostic LLM caller. Starts with Gemini only (matching the orchestrator pattern), but structured for future providers:

```typescript
import type { LLMConfig } from "./config";

export interface LLMResponse {
  text: string;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: "gemini",
  model: "gemini-2.0-flash",
  apiKeyEnv: "GEMINI_API_KEY",
};

export async function callLLM(
  prompt: string,
  config?: LLMConfig
): Promise<LLMResponse> {
  const cfg = config ?? DEFAULT_CONFIG;
  const apiKey = process.env[cfg.apiKeyEnv];

  if (!apiKey) {
    throw new Error(
      `LLM API key not found. Set the ${cfg.apiKeyEnv} environment variable.`
    );
  }

  if (cfg.provider === "gemini") {
    return callGemini(prompt, cfg.model, apiKey);
  }

  throw new Error(`Unsupported LLM provider: ${cfg.provider}`);
}

async function callGemini(
  prompt: string,
  model: string,
  apiKey: string
): Promise<LLMResponse> {
  // Use fetch directly — no SDK dependency needed for a single endpoint
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");

  return { text };
}

/**
 * Call LLM and parse JSON response. Throws on invalid JSON.
 */
export async function callLLMJson<T>(
  prompt: string,
  config?: LLMConfig
): Promise<T> {
  const response = await callLLM(prompt, config);
  return JSON.parse(response.text) as T;
}
```

No new dependencies — uses `fetch` directly (available in Bun). This avoids adding `@google/genai` to obsidian-memory's package.json.

### 3. Enrichment logic: `src/lib/enricher.ts`

Core enrichment engine that reads a session and produces structured extraction:

```typescript
import { callLLMJson } from "./llm";
import type { LLMConfig } from "./config";

export interface EnrichmentResult {
  features: Array<{
    slug: string;
    title: string;
    summary: string;
    status: "draft" | "in-progress" | "completed";
    categories: string[];
    keyFiles: Array<{ path: string; role: string }>;
  }>;
  decisions: Array<{
    title: string;
    context: string;
    decision: string;
    categories: string[];
    impacts: string[];        // feature slugs
    alternatives: Array<{ name: string; proscons: string }>;
    consequences: string;
  }>;
  crossLinks: {
    features_touched: string[];  // feature slugs
    decisions_made: string[];    // will become ADR slugs after creation
    topics: string[];            // topic keywords
  };
  contextDrift: string | null;   // warning if context.md seems stale
}

const ENRICHMENT_PROMPT = `You are a technical documentation agent. Analyze this session note and extract structured information.

## Session Note
{SESSION_CONTENT}

## Existing Features
{FEATURE_INDEX}

## Existing Decisions
{DECISION_INDEX}

---

Extract the following as JSON:

1. "features": New features implemented or significantly modified in this session. Only include features that don't already exist in the feature index. Each needs: slug (kebab-case), title, summary (one sentence), status, categories (domain tags), keyFiles (path + role).

2. "decisions": Significant technical decisions made (architecture, library choices, design patterns). Only include non-trivial decisions — not "used a for loop". Each needs: title, context (problem), decision (what was chosen), categories, impacts (feature slugs affected), alternatives (name + pros/cons/why rejected), consequences.

3. "crossLinks": { features_touched (slugs of ALL features this session touched, including existing ones), decisions_made (titles of decisions), topics (2-5 topic keywords like "authentication", "database", "testing") }

4. "contextDrift": If the session's work seems to contradict or go beyond what the project context describes, return a one-sentence warning. Otherwise null.

Rules:
- Return ONLY valid JSON, no markdown fences
- If no features/decisions were found, return empty arrays
- Prefer updating existing features over creating new ones (check the index)
- Slug format: lowercase, hyphens, max 30 chars (e.g., "auth-jwt", "todo-crud")
- Be conservative: only extract real features and real decisions, not trivial changes`;

export async function enrichSession(
  sessionContent: string,
  featureIndex: string,
  decisionIndex: string,
  llmConfig?: LLMConfig
): Promise<EnrichmentResult> {
  const prompt = ENRICHMENT_PROMPT
    .replace("{SESSION_CONTENT}", sessionContent)
    .replace("{FEATURE_INDEX}", featureIndex || "_No features yet._")
    .replace("{DECISION_INDEX}", decisionIndex || "_No decisions yet._");

  return callLLMJson<EnrichmentResult>(prompt, llmConfig);
}
```

### 4. New command: `src/commands/maintain.ts`

The `maintain` command orchestrates enrichment:

```typescript
import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { enrichSession, type EnrichmentResult } from "../lib/enricher";
import { runSaveFeature } from "./save-feature";
import { runSaveDecision } from "./save-decision";

export interface MaintainOptions {
  enrich?: boolean;
  session?: string;       // specific session path to enrich
}

export interface MaintainResult {
  sessionsEnriched: number;
  featuresCreated: string[];
  decisionsCreated: string[];
  crossLinksAdded: number;
  contextDriftWarnings: string[];
  message: string;
}

export async function runMaintain(
  cwd: string,
  options: MaintainOptions
): Promise<MaintainResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory.json found. Run `obsidian-memory init` first.");
  }

  const { vault, project, llm } = found.config;
  const cli = new ObsidianCLI(vault);

  const result: MaintainResult = {
    sessionsEnriched: 0,
    featuresCreated: [],
    decisionsCreated: [],
    crossLinksAdded: 0,
    contextDriftWarnings: [],
    message: "",
  };

  if (options.enrich) {
    // Find session(s) to enrich
    const sessionPaths = await findSessionsToEnrich(cli, project, options.session);

    if (sessionPaths.length === 0) {
      result.message = "No unenriched sessions found.";
      return result;
    }

    // Load existing indexes for context
    const featureIndex = await safeRead(cli, `Memory/Projects/${project}/Docs/Features.md`);
    const decisionIndex = await safeRead(cli, `Memory/Projects/${project}/decisions.md`);

    for (const sessionPath of sessionPaths) {
      try {
        const sessionContent = await cli.read({ path: sessionPath });

        // Call LLM for enrichment
        const enrichment = await enrichSession(
          sessionContent,
          featureIndex,
          decisionIndex,
          llm
        );

        // Create feature notes
        for (const feature of enrichment.features) {
          try {
            await runSaveFeature(cwd, {
              slug: feature.slug,
              title: feature.title,
              summary: feature.summary,
              status: feature.status,
              categories: feature.categories,
              keyFiles: feature.keyFiles.map(kf => `${kf.path}:${kf.role}`),
              sessions: [sessionPath.split("/").pop()?.replace(".md", "") || ""],
            });
            result.featuresCreated.push(feature.slug);
          } catch {
            // Feature may already exist — skip
          }
        }

        // Create ADR notes
        for (const decision of enrichment.decisions) {
          try {
            const { adrNumber } = await runSaveDecision(cwd, {
              title: decision.title,
              context: decision.context,
              decision: decision.decision,
              categories: decision.categories,
              impacts: decision.impacts,
              alternatives: decision.alternatives.map(
                a => `${a.name}: ${a.proscons}`
              ),
              consequences: decision.consequences,
            });
            result.decisionsCreated.push(`ADR-${String(adrNumber).padStart(3, "0")}`);
          } catch {
            // Decision creation failed — skip
          }
        }

        // Update session frontmatter with cross-links
        await updateSessionFrontmatter(cli, sessionPath, enrichment);
        result.crossLinksAdded++;

        // Track context drift warnings
        if (enrichment.contextDrift) {
          result.contextDriftWarnings.push(enrichment.contextDrift);
        }

        result.sessionsEnriched++;
      } catch (err) {
        // Log but continue with next session
        console.error(`Failed to enrich ${sessionPath}: ${err}`);
      }
    }

    result.message = formatMaintainResult(result);
  }

  return result;
}

async function findSessionsToEnrich(
  cli: ObsidianCLI,
  project: string,
  specificSession?: string
): Promise<string[]> {
  if (specificSession) {
    // Verify it exists and isn't already enriched
    const content = await cli.read({ path: specificSession });
    if (content.includes("enriched: true")) return [];
    return [specificSession];
  }

  // Find most recent unenriched session for this project
  const results = await cli.search(project, {
    path: "Memory/Sessions/",
    limit: 10,
  });

  const unenriched: string[] = [];
  for (const result of results) {
    try {
      const content = await cli.read({ path: result.path });
      if (!content.includes("enriched: true")) {
        unenriched.push(result.path);
      }
    } catch {}
  }

  // Return only the most recent unenriched session (to avoid bulk LLM calls)
  return unenriched.slice(0, 1);
}

async function updateSessionFrontmatter(
  cli: ObsidianCLI,
  sessionPath: string,
  enrichment: EnrichmentResult
): Promise<void> {
  // Read current content
  const content = await cli.read({ path: sessionPath });

  // Build new frontmatter fields
  const additions: string[] = [];
  additions.push("enriched: true");

  if (enrichment.crossLinks.features_touched.length > 0) {
    additions.push("features_touched:");
    for (const f of enrichment.crossLinks.features_touched) {
      additions.push(`  - ${f}`);
    }
  }
  if (enrichment.crossLinks.decisions_made.length > 0) {
    additions.push("decisions_made:");
    for (const d of enrichment.crossLinks.decisions_made) {
      additions.push(`  - ${d}`);
    }
  }
  if (enrichment.crossLinks.topics.length > 0) {
    additions.push("topics:");
    for (const t of enrichment.crossLinks.topics) {
      additions.push(`  - ${t}`);
    }
  }

  // Insert new fields before the closing --- of frontmatter
  const updated = content.replace(
    /^(---\n[\s\S]*?)(---)/m,
    `$1${additions.join("\n")}\n$2`
  );

  // Overwrite the note
  await cli.create({
    name: sessionPath,
    content: updated,
    overwrite: true,
  });
}

async function safeRead(cli: ObsidianCLI, path: string): Promise<string> {
  try {
    return await cli.read({ path });
  } catch {
    return "";
  }
}

function formatMaintainResult(result: MaintainResult): string {
  const lines: string[] = [];
  lines.push(`Enriched ${result.sessionsEnriched} session(s).`);
  if (result.featuresCreated.length > 0) {
    lines.push(`  Features created: ${result.featuresCreated.join(", ")}`);
  }
  if (result.decisionsCreated.length > 0) {
    lines.push(`  Decisions created: ${result.decisionsCreated.join(", ")}`);
  }
  if (result.crossLinksAdded > 0) {
    lines.push(`  Cross-links added to ${result.crossLinksAdded} session(s).`);
  }
  if (result.contextDriftWarnings.length > 0) {
    lines.push(`\n⚠ Context drift detected:`);
    for (const w of result.contextDriftWarnings) {
      lines.push(`  - ${w}`);
    }
  }
  return lines.join("\n");
}
```

### 5. CLI registration: `src/index.ts`

Add the `maintain` command after `consolidate`:

```typescript
import { runMaintain } from "./commands/maintain";

program
  .command("maintain")
  .description("Run agentic maintenance on the memory vault")
  .option("--enrich", "Enrich unenriched sessions (extract features, decisions, cross-links)")
  .option("--session <path>", "Specific session note path to enrich")
  .action(async (opts) => {
    try {
      const result = await runMaintain(process.cwd(), {
        enrich: opts.enrich,
        session: opts.session,
      });
      console.log(result.message);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });
```

### 6. Update AGENTS.md template: `src/templates/agents-md.ts`

Add `maintain` to the Command Reference table:

```
| \`obsidian-memory maintain --enrich\` | Auto-extract features, decisions, and cross-links from sessions |
```

Add a section about enrichment after the Documentation Protocol:

```markdown
## Automatic Enrichment

After saving a session, you can run enrichment to automatically create feature notes,
ADR notes, and cross-links from the session content:

\`\`\`bash
obsidian-memory maintain --enrich
\`\`\`

This uses an LLM to analyze the session and extract structured artifacts.
Requires a \`GEMINI_API_KEY\` environment variable (or the key configured in \`.obsidian-memory.json\`).
```

### 7. Update init command: `src/commands/init.ts`

When running `init` interactively, add an optional prompt for LLM config:

```typescript
// After the agents multiselect, add:
llmSetup: () =>
  p.confirm({
    message: "Enable LLM-powered enrichment? (requires Gemini API key)",
    initialValue: false,
  }),
```

If confirmed, add the default `llm` config to `.obsidian-memory.json`.

## Testing Strategy

### Unit tests: `tests/unit/llm.test.ts`

- `callLLM()` throws when API key env var is missing
- `callLLM()` throws on unsupported provider
- `callLLMJson()` throws on invalid JSON response
- (Integration/mock) `callGemini()` constructs correct request body and URL

### Unit tests: `tests/unit/enricher.test.ts`

- `enrichSession()` builds correct prompt with session content and indexes
- `enrichSession()` returns empty arrays for sessions with no features/decisions
- Prompt includes feature and decision indexes for context
- (Mock LLM) Full enrichment flow: session → features + decisions + cross-links

### Command tests: `tests/commands/maintain.test.ts`

Follow the pattern in `tests/commands/save-session.test.ts`:

- `--enrich` finds most recent unenriched session
- Skips sessions with `enriched: true` in frontmatter
- `--session <path>` targets a specific session
- Creates feature notes via `runSaveFeature()` for extracted features
- Creates ADR notes via `runSaveDecision()` for extracted decisions
- Updates session frontmatter with `enriched: true` and cross-link fields
- Handles LLM errors gracefully (logs error, continues)
- No-op when no unenriched sessions exist

### Run: `bun test`

## Out of Scope

- Anthropic/OpenAI provider implementations (Gemini only for now; structure supports future providers)
- Auto-triggering enrichment after every `save-session` (manual `maintain --enrich` for now)
- Enriching multiple sessions in one call (processes one at a time to control LLM costs)
- Updating existing feature/ADR notes (only creates new ones; manual updates via `create-note --overwrite`)
- Context.md auto-updating from drift warnings (just warns; human or future Wave 3 handles updates)
