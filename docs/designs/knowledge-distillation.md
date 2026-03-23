# Knowledge Distillation Consolidation Replacing Lossy Merges

## Context

The current `consolidate` command (in `src/commands/consolidate.ts`) merges old sessions into monthly journal entries by extracting only the `## Summary` section text and concatenating it. This is lossy: decisions, files modified, blockers, next steps, and all wikilinks are discarded. A month-old decision about "why we chose JWT over sessions" becomes a one-liner buried in a journal. The most valuable parts of session notes — the reasoning chain — are thrown away.

This issue replaces the lossy merge with LLM-powered knowledge distillation. Instead of concatenating summaries into journals, the LLM reads all sessions in a time window and produces: updated canonical docs (context.md, feature notes, decision index), a rich journal entry with patterns and themes, and tags old sessions as archived.

**Depends on:** FAU-28 (save-feature) — distillation may discover features not yet documented.
**Also uses:** FAU-31 (maintain-enrich) — shares the `src/lib/llm.ts` module for LLM calls.

## Requirements

- Add `--distill` flag to the existing `consolidate` command
- LLM reads all sessions in the consolidation window and produces structured knowledge extraction
- Updates canonical docs: context.md (current state, architecture), decisions.md (new entries from sessions), Features.md index
- Creates a rich journal entry with: themes, patterns, key accomplishments, decisions summary, outstanding blockers
- Tags consolidated sessions with `archived: true` in frontmatter (keeps them searchable but excluded from `load-context`)
- Original session notes are preserved (not deleted) — journals are a synthesis layer, not a replacement
- Falls back to current lossy behavior when LLM is unavailable (no API key)

## Implementation

### 1. Extend consolidate options: `src/commands/consolidate.ts`

Add `distill` flag to the existing interface:

```typescript
export interface ConsolidateOptions {
  daysThreshold?: number;
  auto?: boolean;
  distill?: boolean;    // NEW: use LLM for knowledge distillation
}

export interface ConsolidateResult {
  sessionsFound: number;
  grouped: Map<string, SearchResult[]>;
  message: string;
  distillation?: DistillationResult;  // NEW: present when --distill used
}
```

### 2. Distillation engine: `src/lib/distiller.ts`

New module that takes a batch of session contents and produces structured knowledge:

```typescript
import { callLLMJson } from "./llm";
import type { LLMConfig } from "./config";

export interface DistillationResult {
  journal: JournalEntry;
  contextUpdates: ContextUpdates | null;
  newDecisions: DecisionExtract[];
  newFeatures: FeatureExtract[];
}

export interface JournalEntry {
  period: string;            // "2026-02" (YYYY-MM)
  themes: string[];          // 3-5 high-level themes
  accomplishments: string;   // prose paragraph
  decisionsSummary: string;  // prose paragraph summarizing decisions made
  patternsObserved: string;  // recurring patterns, conventions that emerged
  outstandingBlockers: string[]; // blockers that were never resolved
  weeklyBreakdown: Array<{
    week: string;            // "Week of 2026-02-03"
    highlights: string[];    // one-liner per session
  }>;
}

export interface ContextUpdates {
  currentState: string | null;  // new "Current State" content for progress.md
  techStack: string | null;     // updates to context.md Tech Stack section
  architecture: string | null;  // updates to context.md Architecture section
}

export interface DecisionExtract {
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface FeatureExtract {
  slug: string;
  title: string;
  summary: string;
  status: "in-progress" | "completed";
}

const DISTILLATION_PROMPT = `You are a technical documentation agent performing knowledge distillation.
You are given a batch of session notes from the same month for the same project. Your job is to
synthesize these into structured knowledge that updates the project's canonical documentation.

## Project Context
{PROJECT_CONTEXT}

## Current Progress
{PROGRESS}

## Existing Feature Index
{FEATURE_INDEX}

## Existing Decision Index
{DECISION_INDEX}

## Sessions to Distill (oldest first)
{SESSIONS}

---

Analyze all sessions and produce a JSON object with these fields:

1. "journal": A rich monthly journal entry:
   - "period": the month (YYYY-MM format)
   - "themes": 3-5 high-level themes that emerged across sessions
   - "accomplishments": one prose paragraph summarizing what was built/achieved
   - "decisionsSummary": one prose paragraph summarizing key decisions and their reasoning
   - "patternsObserved": recurring patterns, conventions, or approaches that solidified
   - "outstandingBlockers": array of blockers mentioned but never resolved
   - "weeklyBreakdown": array of { week: "Week of YYYY-MM-DD", highlights: ["one-liner per session"] }

2. "contextUpdates": Updates to the project's canonical docs, or null if nothing changed significantly:
   - "currentState": new "Current State" text reflecting where the project is NOW (or null)
   - "techStack": any tech stack changes to note (or null)
   - "architecture": any architecture changes to note (or null)

3. "newDecisions": Decisions mentioned in sessions that don't appear in the existing decision index.
   Each: { title, context, decision, consequences }. Only include significant architectural/design decisions.

4. "newFeatures": Features implemented in sessions that don't appear in the existing feature index.
   Each: { slug (kebab-case), title, summary, status }. Only include real features, not bugfixes.

Rules:
- Return ONLY valid JSON, no markdown fences
- Be conservative: only extract decisions and features that are genuinely new
- The journal should SYNTHESIZE, not concatenate — find themes and patterns across sessions
- Outstanding blockers are blockers that appeared in sessions but were never marked as resolved in later sessions
- Weekly breakdown highlights should be one sentence each, capturing the essence of each session`;

export async function distillSessions(
  sessions: Array<{ path: string; content: string; date: string }>,
  projectContext: string,
  progress: string,
  featureIndex: string,
  decisionIndex: string,
  llmConfig?: LLMConfig
): Promise<DistillationResult> {
  // Sort sessions by date (oldest first) for chronological narrative
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));

  const sessionsText = sorted
    .map(s => `### ${s.path.split("/").pop()}\n${s.content}`)
    .join("\n\n---\n\n");

  const prompt = DISTILLATION_PROMPT
    .replace("{PROJECT_CONTEXT}", projectContext || "_No context available._")
    .replace("{PROGRESS}", progress || "_No progress notes._")
    .replace("{FEATURE_INDEX}", featureIndex || "_No features yet._")
    .replace("{DECISION_INDEX}", decisionIndex || "_No decisions yet._")
    .replace("{SESSIONS}", sessionsText);

  return callLLMJson<DistillationResult>(prompt, llmConfig);
}
```

### 3. Journal note template: `src/templates/note-templates.ts`

Add a rich journal note generator:

```typescript
export interface JournalNoteOptions {
  project: string;
  period: string;           // YYYY-MM
  themes: string[];
  accomplishments: string;
  decisionsSummary: string;
  patternsObserved: string;
  outstandingBlockers: string[];
  weeklyBreakdown: Array<{
    week: string;
    highlights: string[];
  }>;
  sessionsArchived: number;
}

export function journalNote(options: JournalNoteOptions): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("type: journal");
  lines.push(`project: ${options.project}`);
  lines.push(`period: ${options.period}`);
  lines.push(`created: ${new Date().toISOString().split("T")[0]}`);
  lines.push("method: distillation");
  lines.push("tags:");
  lines.push("  - journal");
  lines.push(`  - project/${options.project}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Journal — ${options.period} — ${options.project}`);
  lines.push("");
  lines.push(`> Distilled from ${options.sessionsArchived} session(s).`);
  lines.push("");

  // Themes
  lines.push("## Themes");
  for (const t of options.themes) lines.push(`- ${t}`);
  lines.push("");

  // Accomplishments
  lines.push("## Accomplishments");
  lines.push(options.accomplishments);
  lines.push("");

  // Weekly breakdown
  lines.push("## Weekly Breakdown");
  for (const week of options.weeklyBreakdown) {
    lines.push(`### ${week.week}`);
    for (const h of week.highlights) lines.push(`- ${h}`);
    lines.push("");
  }

  // Decisions
  lines.push("## Decisions Summary");
  lines.push(options.decisionsSummary);
  lines.push("");

  // Patterns
  lines.push("## Patterns & Conventions");
  lines.push(options.patternsObserved);
  lines.push("");

  // Blockers
  if (options.outstandingBlockers.length > 0) {
    lines.push("## Outstanding Blockers");
    for (const b of options.outstandingBlockers) lines.push(`- ${b}`);
    lines.push("");
  }

  return lines.join("\n");
}
```

### 4. Update consolidate command: `src/commands/consolidate.ts`

Add the distillation path alongside the existing `--auto` path. The existing lossy behavior remains as fallback. Key changes to `runConsolidate()`:

After the existing `if (options?.auto)` block (line 78), add a new branch:

```typescript
// LLM-powered distillation (new path)
if (options?.distill) {
  const llmConfig = found.config.llm;

  // Check LLM availability — fall back to --auto behavior if unavailable
  const apiKeyEnv = llmConfig?.apiKeyEnv ?? "GEMINI_API_KEY";
  if (!process.env[apiKeyEnv]) {
    console.log(`[consolidate] LLM key (${apiKeyEnv}) not set, falling back to summary-only mode.`);
    // Fall through to existing --auto behavior below
  } else {
    // Load canonical docs for context
    const projectContext = await safeRead(cli, `Memory/Projects/${project}/context.md`);
    const progress = await safeRead(cli, `Memory/Projects/${project}/progress.md`);
    const featureIndex = await safeRead(cli, `Memory/Projects/${project}/Docs/Features.md`);
    const decisionIndex = await safeRead(cli, `Memory/Projects/${project}/decisions.md`);

    for (const [month, sessions] of grouped) {
      // Read all session contents
      const sessionData: Array<{ path: string; content: string; date: string }> = [];
      for (const session of sessions) {
        try {
          const content = await cli.read({ path: session.path });
          const filename = session.path.split("/").pop() || "";
          const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
          sessionData.push({
            path: session.path,
            content,
            date: dateMatch?.[1] || "",
          });
        } catch {}
      }

      if (sessionData.length === 0) continue;

      // Call LLM for distillation
      const distillation = await distillSessions(
        sessionData,
        projectContext,
        progress,
        featureIndex,
        decisionIndex,
        llmConfig
      );

      // 1. Create rich journal entry
      const journalContent = journalNote({
        project,
        period: month,
        themes: distillation.journal.themes,
        accomplishments: distillation.journal.accomplishments,
        decisionsSummary: distillation.journal.decisionsSummary,
        patternsObserved: distillation.journal.patternsObserved,
        outstandingBlockers: distillation.journal.outstandingBlockers,
        weeklyBreakdown: distillation.journal.weeklyBreakdown,
        sessionsArchived: sessionData.length,
      });

      try {
        await cli.create({
          name: `Memory/Journal/${month}`,
          content: journalContent,
          overwrite: true,
        });
      } catch {
        await cli.create({
          name: `Memory/Journal/${month}`,
          content: journalContent,
          silent: true,
        });
      }

      // 2. Apply context updates
      if (distillation.contextUpdates) {
        await applyContextUpdates(cli, project, distillation.contextUpdates);
      }

      // 3. Create new decisions via save-decision
      for (const decision of distillation.newDecisions) {
        try {
          await runSaveDecision(found.dir, {
            title: decision.title,
            context: decision.context,
            decision: decision.decision,
            consequences: decision.consequences,
          });
        } catch {}
      }

      // 4. Create new features via save-feature
      for (const feature of distillation.newFeatures) {
        try {
          await runSaveFeature(found.dir, {
            slug: feature.slug,
            title: feature.title,
            summary: feature.summary,
            status: feature.status,
          });
        } catch {}
      }

      // 5. Tag sessions as archived
      for (const session of sessionData) {
        await archiveSession(cli, session.path, session.content);
      }
    }

    return {
      sessionsFound: results.length,
      grouped,
      message: `Distilled ${totalOld} sessions across ${grouped.size} month(s) into enriched journal entries.`,
    };
  }
}

// Existing --auto fallback (lossy concatenation) remains unchanged below
```

### 5. Helper functions in consolidate.ts:

```typescript
import { distillSessions } from "../lib/distiller";
import { journalNote } from "../templates/note-templates";
import { runSaveDecision } from "./save-decision";
import { runSaveFeature } from "./save-feature";

async function safeRead(cli: ObsidianCLI, path: string): Promise<string> {
  try {
    return await cli.read({ path });
  } catch {
    return "";
  }
}

async function applyContextUpdates(
  cli: ObsidianCLI,
  project: string,
  updates: { currentState: string | null; techStack: string | null; architecture: string | null }
): Promise<void> {
  // Update progress.md Current State section
  if (updates.currentState) {
    try {
      const progress = await cli.read({
        path: `Memory/Projects/${project}/progress.md`,
      });
      const updated = progress.replace(
        /## Current State\n[\s\S]*?(?=\n## )/,
        `## Current State\n${updates.currentState}\n\n`
      );
      await cli.create({
        name: `Memory/Projects/${project}/progress.md`,
        content: updated,
        overwrite: true,
      });
    } catch {}
  }

  // Update context.md Tech Stack / Architecture sections
  if (updates.techStack || updates.architecture) {
    try {
      let context = await cli.read({
        path: `Memory/Projects/${project}/context.md`,
      });
      if (updates.techStack) {
        context = context.replace(
          /## Tech Stack\n[\s\S]*?(?=\n## )/,
          `## Tech Stack\n${updates.techStack}\n\n`
        );
      }
      if (updates.architecture) {
        context = context.replace(
          /## Architecture\n[\s\S]*?(?=\n## )/,
          `## Architecture\n${updates.architecture}\n\n`
        );
      }
      await cli.create({
        name: `Memory/Projects/${project}/context.md`,
        content: context,
        overwrite: true,
      });
    } catch {}
  }
}

async function archiveSession(
  cli: ObsidianCLI,
  sessionPath: string,
  content: string
): Promise<void> {
  // Add archived: true to frontmatter
  if (content.includes("archived: true")) return; // already archived

  const updated = content.replace(
    /^(---\n[\s\S]*?)(---)/m,
    `$1archived: true\n$2`
  );

  await cli.create({
    name: sessionPath,
    content: updated,
    overwrite: true,
  });
}
```

### 6. CLI registration update: `src/index.ts`

Update the existing `consolidate` command to add the `--distill` flag:

```typescript
program
  .command("consolidate")
  .description("Merge stale or overlapping memory notes")
  .option("--days <n>", "Consolidate sessions older than N days", "30")
  .option("--auto", "Auto-merge without confirmation (summary-only)")
  .option("--distill", "Use LLM to distill sessions into enriched journal entries and update canonical docs")
  .action(async (opts) => {
    try {
      const result = await runConsolidate(process.cwd(), {
        daysThreshold: parseInt(opts.days, 10),
        auto: opts.auto || opts.distill,  // distill implies auto
        distill: opts.distill,
      });
      console.log(result.message);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });
```

### 7. Update load-context to skip archived sessions

In `src/commands/load-context.ts`, when loading recent sessions, filter out archived ones. In the session-reading loop, add a check:

```typescript
// Inside the session loading loop (both Tier 2 and Full mode):
const content = await cli.read({ path: result.path });
// Skip archived sessions
if (content.includes("archived: true")) continue;
```

### 8. Update AGENTS.md template: `src/templates/agents-md.ts`

Update the Memory Consolidation section:

```markdown
## Memory Consolidation

If the vault has many old session notes, suggest running:

\`\`\`bash
# LLM-powered distillation (recommended — produces rich journals + updates canonical docs)
obsidian-memory consolidate --distill

# Simple summary-only mode (no LLM required)
obsidian-memory consolidate --auto
\`\`\`

Distillation reads old sessions, synthesizes themes and patterns, updates project context
and progress, creates missing feature/decision notes, and archives the original sessions.
Requires a \`GEMINI_API_KEY\` environment variable.
```

## Testing Strategy

### Unit tests: `tests/unit/distiller.test.ts`

- `distillSessions()` builds prompt with all sessions sorted chronologically
- `distillSessions()` includes project context and indexes in prompt
- (Mock LLM) Returns valid `DistillationResult` shape
- Handles empty session list gracefully

### Unit tests: `tests/unit/journal-note-template.test.ts`

- `journalNote()` produces valid YAML frontmatter with `method: distillation`
- `journalNote()` renders themes, accomplishments, weekly breakdown
- `journalNote()` renders outstanding blockers when present
- `journalNote()` omits blockers section when empty

### Command tests: `tests/commands/consolidate-distill.test.ts`

Follow existing `consolidate` test patterns:

- `--distill` calls LLM and produces rich journal entry
- `--distill` falls back to `--auto` behavior when API key missing
- `--distill` creates feature notes for newly discovered features
- `--distill` creates decision notes for newly discovered decisions
- `--distill` applies context updates to progress.md and context.md
- `--distill` tags sessions with `archived: true` in frontmatter
- `--distill` skips already-archived sessions
- Original session notes are NOT deleted
- Existing `--auto` behavior unchanged (backwards compatible)
- `load-context` skips sessions with `archived: true`

### Run: `bun test`

## Out of Scope

- Deleting archived sessions (they're kept for full-text search and history)
- Cross-project distillation (sessions are always per-project)
- Scheduling distillation on a cron (manual trigger only; claude-orchestrator can automate separately)
- Conflict resolution when LLM-generated context updates contradict recent sessions (LLM output is applied as-is; future Wave 3 audit would catch inconsistencies)
