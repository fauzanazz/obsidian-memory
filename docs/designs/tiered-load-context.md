# Tiered load-context with --minimal and --focus flags

## Context

`load-context` currently dumps everything into one blob: project context, progress, decisions, module docs, conventions, and the last N sessions. As a project accumulates memory (50+ decisions, dozens of session notes, rich module docs), this output grows unbounded and wastes the agent's context window on irrelevant information. The agent working on "add rate limiting" doesn't need the full authentication ADR history.

This issue adds tiered output to `load-context`: a compact default mode, a `--minimal` mode for constrained contexts, and a `--focus` mode that filters by relevance keyword. The key insight: every piece of memory should exist at multiple summary depths — one-line for indexes, one-paragraph for context loading, and full-detail for search-accessed deep dives.

## Requirements

- `load-context` (no flags) produces **Tier 1 + Tier 2**: project summary, current state, active blockers, last session's next steps, plus compact indexes (features, decisions, modules — one line each)
- `--minimal` produces **Tier 1 only**: project summary, current state, active blockers, last session's next steps (~500 tokens)
- `--focus <keyword>` produces **Tier 1 + keyword-filtered Tier 2+3**: loads full content only for notes matching the keyword, compact indexes for everything else
- `--full` produces the **current behavior** (everything, backwards compatible)
- Existing `--no-conventions`, `--no-decisions`, `--sessions <n>` flags continue to work

## Implementation

### 1. New types: `src/commands/load-context.ts`

Extend the existing `LoadContextOptions` interface:

```typescript
export type LoadContextTier = "minimal" | "default" | "focus" | "full";

export interface LoadContextOptions {
  tier?: LoadContextTier;            // NEW: default "default"
  focus?: string;                    // NEW: keyword for focus mode
  includeConventions?: boolean;      // existing
  includeDecisions?: boolean;        // existing
  includeSessions?: number;          // existing
}

const DEFAULTS: Required<Omit<LoadContextOptions, "focus">> = {
  tier: "default",
  includeConventions: true,
  includeDecisions: true,
  includeSessions: 3,
};
```

### 2. Refactor `runLoadContext()`: `src/commands/load-context.ts`

Replace the current monolithic function with a tier-based builder. The full file rewrite:

```typescript
export async function runLoadContext(
  cwd: string,
  options?: LoadContextOptions
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  // If focus is provided, force tier to "focus"
  if (opts.focus) opts.tier = "focus";

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);
  const sections: string[] = [];

  // ── Tier 1: Always loaded ──────────────────────────────────
  await loadTier1(cli, project, sections);

  if (opts.tier === "minimal") {
    return formatOutput(project, sections);
  }

  // ── Tier 2: Compact indexes ────────────────────────────────
  await loadTier2(cli, project, sections, opts);

  if (opts.tier === "default") {
    return formatOutput(project, sections);
  }

  // ── Tier 3 (focus mode): Full content for matching notes ───
  if (opts.tier === "focus" && opts.focus) {
    await loadFocused(cli, project, sections, opts.focus);
    return formatOutput(project, sections);
  }

  // ── Full mode: Everything (backwards compatible) ───────────
  await loadFull(cli, project, sections, opts);
  return formatOutput(project, sections);
}

function formatOutput(project: string, sections: string[]): string {
  if (sections.length === 0) {
    return "# Memory Context\n\n_No memory found for this project._";
  }
  return `# Memory Context — ${project}\n\n` + sections.join("\n\n---\n\n");
}
```

### 3. Tier 1 loader (always included, ~500 tokens):

```typescript
async function loadTier1(
  cli: ObsidianCLI,
  project: string,
  sections: string[]
): Promise<void> {
  // Project summary — extract first paragraph from context.md
  try {
    const context = await cli.read({
      path: `Memory/Projects/${project}/context.md`,
    });
    const summary = extractSummary(context);
    sections.push("## Project\n\n" + summary);
  } catch {
    sections.push("## Project\n\n_No project context found._");
  }

  // Current state + blockers from progress.md
  try {
    const progress = await cli.read({
      path: `Memory/Projects/${project}/progress.md`,
    });
    const compact = extractProgressCompact(progress);
    if (compact) sections.push("## Current State\n\n" + compact);
  } catch {
    // optional
  }

  // Last session's next steps (most recent session only)
  try {
    const results = await cli.search(project, {
      path: "Memory/Sessions/",
      limit: 1,
    });
    if (results.length > 0) {
      const content = await cli.read({ path: results[0].path });
      const nextSteps = extractSection(content, "Next Steps");
      const summary = extractSection(content, "Summary");
      if (summary || nextSteps) {
        const parts: string[] = [];
        if (summary) parts.push(`**Last session:** ${summary.trim()}`);
        if (nextSteps) parts.push(`**Pending next steps:**\n${nextSteps}`);
        sections.push("## Continuity\n\n" + parts.join("\n\n"));
      }
    }
  } catch {
    // optional
  }
}
```

### 4. Tier 2 loader (compact indexes, ~2000 tokens):

```typescript
async function loadTier2(
  cli: ObsidianCLI,
  project: string,
  sections: string[],
  opts: Required<Omit<LoadContextOptions, "focus">>
): Promise<void> {
  // Feature index (one-line per feature)
  try {
    const featuresDoc = await cli.read({
      path: `Memory/Projects/${project}/Docs/Features.md`,
    });
    const index = extractSection(featuresDoc, "Feature Index");
    if (index?.trim()) {
      sections.push("## Features\n\n" + index.trim());
    }
  } catch {}

  // Decision index (one-line per ADR)
  if (opts.includeDecisions) {
    try {
      const decisionsDoc = await cli.read({
        path: `Memory/Projects/${project}/decisions.md`,
      });
      const log = extractSection(decisionsDoc, "Decision Log");
      if (log?.trim()) {
        sections.push("## Decisions\n\n" + log.trim());
      } else {
        // Backwards compat: old inline format
        sections.push("## Decisions\n\n" + decisionsDoc);
      }
    } catch {}
  }

  // Module index (directory → purpose, one-line each)
  try {
    const modulesDocs = await cli.read({
      path: `Memory/Projects/${project}/Docs/Modules.md`,
    });
    const moduleIndex = extractSection(modulesDocs, "Module Index");
    if (moduleIndex?.trim()) {
      sections.push("## Modules\n\n" + moduleIndex.trim());
    }
  } catch {}

  // Recent sessions (one-line summaries, not full content)
  if (opts.includeSessions > 0) {
    try {
      const results = await cli.search(project, {
        path: "Memory/Sessions/",
        limit: opts.includeSessions,
      });
      if (results.length > 0) {
        const lines: string[] = [];
        for (const result of results) {
          try {
            const content = await cli.read({ path: result.path });
            const summary = extractSection(content, "Summary");
            const filename = result.path.split("/").pop() || "";
            lines.push(`- [[${filename}]]: ${truncate(summary?.trim() || "No summary", 120)}`);
          } catch {}
        }
        if (lines.length > 0) {
          sections.push("## Recent Sessions\n\n" + lines.join("\n"));
        }
      }
    } catch {}
  }

  // Conventions (compact, if enabled)
  if (opts.includeConventions) {
    try {
      const results = await cli.search("convention", {
        path: "Memory/Conventions/",
      });
      for (const result of results.slice(0, 3)) {
        try {
          const content = await cli.read({ path: result.path });
          sections.push("## Convention\n\n" + truncate(content, 500));
        } catch {}
      }
    } catch {}
  }
}
```

### 5. Focus loader (keyword-filtered deep content):

```typescript
async function loadFocused(
  cli: ObsidianCLI,
  project: string,
  sections: string[],
  keyword: string
): Promise<void> {
  // Search across all project memory for matching notes
  const results = await cli.search(keyword, {
    path: `Memory/Projects/${project}/`,
    limit: 10,
  });

  // Also search sessions
  const sessionResults = await cli.search(keyword, {
    path: "Memory/Sessions/",
    limit: 5,
  });

  const allResults = [...results, ...sessionResults];

  if (allResults.length === 0) {
    sections.push(`## Focus: "${keyword}"\n\n_No matching notes found._`);
    return;
  }

  const focusedSections: string[] = [];
  for (const result of allResults) {
    try {
      const content = await cli.read({ path: result.path });
      const filename = result.path.split("/").pop() || "";
      focusedSections.push(`### ${filename}\n\n${content}`);
    } catch {}
  }

  if (focusedSections.length > 0) {
    sections.push(
      `## Focus: "${keyword}" (${focusedSections.length} notes)\n\n` +
      focusedSections.join("\n\n---\n\n")
    );
  }
}
```

### 6. Full loader (backwards compatible, everything):

```typescript
async function loadFull(
  cli: ObsidianCLI,
  project: string,
  sections: string[],
  opts: Required<Omit<LoadContextOptions, "focus">>
): Promise<void> {
  // Full project context (entire context.md)
  try {
    const context = await cli.read({
      path: `Memory/Projects/${project}/context.md`,
    });
    // Replace the Tier 1 summary with full content
    // Find and replace the "## Project" section
    const projectIdx = sections.findIndex((s) => s.startsWith("## Project"));
    if (projectIdx !== -1) {
      sections[projectIdx] = "## Project Context\n\n" + context;
    }
  } catch {}

  // Full progress file
  try {
    const progress = await cli.read({
      path: `Memory/Projects/${project}/progress.md`,
    });
    const stateIdx = sections.findIndex((s) => s.startsWith("## Current State"));
    if (stateIdx !== -1) {
      sections[stateIdx] = "## Progress\n\n" + progress;
    }
  } catch {}

  // Full module documentation
  try {
    const modulesDocs = await cli.read({
      path: `Memory/Projects/${project}/Docs/Modules.md`,
    });
    sections.push("## Module Documentation\n\n" + modulesDocs);
  } catch {}

  // Full session content (replace one-line summaries with full notes)
  if (opts.includeSessions > 0) {
    try {
      const results = await cli.search(project, {
        path: "Memory/Sessions/",
        limit: opts.includeSessions,
      });
      const sessionContent: string[] = [];
      for (const result of results) {
        try {
          const content = await cli.read({ path: result.path });
          sessionContent.push(content);
        } catch {}
      }
      if (sessionContent.length > 0) {
        // Find and replace the compact session section
        const sessIdx = sections.findIndex((s) => s.startsWith("## Recent Sessions"));
        if (sessIdx !== -1) {
          sections[sessIdx] = "## Recent Sessions\n\n" + sessionContent.join("\n\n---\n\n");
        }
      }
    } catch {}
  }
}
```

### 7. Helper functions (same file, bottom):

```typescript
/**
 * Extract the first meaningful paragraph from a note (skipping frontmatter and headers).
 * Used for Tier 1 project summary.
 */
function extractSummary(content: string): string {
  // Strip frontmatter
  const stripped = content.replace(/^---[\s\S]*?---\n*/, "");
  // Strip the first H1 header
  const noH1 = stripped.replace(/^# .+\n*/, "");
  // Find first paragraph (non-empty line that isn't a header or list)
  const lines = noH1.split("\n");
  const paragraphLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) break; // end of paragraph
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    // Start of a section header means we should capture the section content
    if (trimmed.startsWith("## ")) {
      if (inParagraph) break;
      continue;
    }
    paragraphLines.push(trimmed);
    inParagraph = true;
  }

  return paragraphLines.join("\n") || "_No summary available._";
}

/**
 * Extract compact progress: Current State + Blockers only.
 */
function extractProgressCompact(content: string): string | null {
  const currentState = extractSection(content, "Current State");
  const blockers = extractSection(content, "Blockers");

  const parts: string[] = [];
  if (currentState?.trim()) parts.push("**Current state:**\n" + currentState.trim());
  if (blockers?.trim()) parts.push("**Blockers:**\n" + blockers.trim());

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Extract content under a ## heading until the next ## or end of file.
 */
function extractSection(content: string, heading: string): string | null {
  const regex = new RegExp(
    `## ${heading}\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`
  );
  const match = content.match(regex);
  return match ? match[1] : null;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
```

### 8. CLI flag registration: `src/index.ts`

Update the `load-context` command (lines 128-146) to add new options:

```typescript
program
  .command("load-context")
  .description("Load project context from the memory vault")
  .option("--minimal", "Tier 1 only: project summary, current state, blockers (~500 tokens)")
  .option("--focus <keyword>", "Load full content for notes matching keyword, compact for the rest")
  .option("--full", "Load everything (backwards compatible, original behavior)")
  .option("--no-conventions", "Exclude conventions")
  .option("--no-decisions", "Exclude decisions")
  .option("--sessions <n>", "Number of recent sessions to include", "3")
  .action(async (opts) => {
    try {
      let tier: LoadContextTier = "default";
      if (opts.minimal) tier = "minimal";
      else if (opts.focus) tier = "focus";
      else if (opts.full) tier = "full";

      const output = await runLoadContext(process.cwd(), {
        tier,
        focus: opts.focus,
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

### 9. Update AGENTS.md template: `src/templates/agents-md.ts`

Update the Session Start Protocol section:

```markdown
## Session Start Protocol

At the beginning of every session, run:

\`\`\`bash
obsidian-memory load-context
\`\`\`

This outputs a compact project summary, current state, active blockers, pending next steps,
and one-line indexes of features, decisions, modules, and recent sessions.

**Options for different needs:**
- \`--minimal\` — just the essentials (~500 tokens, use when context is tight)
- \`--focus "auth"\` — full detail for auth-related notes, compact for the rest
- \`--full\` — everything (full session notes, full docs, full conventions)
```

### 10. Update skill: `skills/obsidian-memory/SKILL.md`

Update the load-context section to document the new tiers and flags.

## Testing Strategy

### Unit tests: `tests/unit/load-context-helpers.test.ts`

- `extractSummary()` strips frontmatter and returns first paragraph
- `extractSummary()` returns fallback when no content
- `extractProgressCompact()` extracts Current State and Blockers
- `extractProgressCompact()` returns null when both sections empty
- `extractSection()` extracts content between headings
- `extractSection()` returns null for missing heading
- `truncate()` handles strings shorter than limit

### Command tests: `tests/commands/load-context.test.ts`

Update existing tests and add new ones:

- Default tier produces Tier 1 + Tier 2 sections (project, state, features index, decisions index, modules index, sessions one-liners)
- `--minimal` produces only Tier 1 (project, state, continuity)
- `--minimal` does NOT include full decisions, modules, or session content
- `--focus "auth"` includes full content for auth-matching notes
- `--full` produces all content (backwards compat with current behavior)
- Existing `--no-conventions` and `--no-decisions` flags still work
- Graceful fallback when notes don't exist (no crashes on empty vault)
- Backwards compatible with old `decisions.md` inline format (no `## Decision Log` header)

### Run: `bun test`

## Out of Scope

- LLM-scored relevance for `--focus` (that's Wave 3; this uses keyword matching via Obsidian search)
- Token counting / budget-based context loading
- Caching of context between consecutive calls
- Interactive context selection (agent picks which notes to load)
