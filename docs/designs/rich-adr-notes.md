# Rich ADR Notes with Alternatives and Consequences

## Context

obsidian-memory's decision log (`decisions.md`) currently stores decisions as 3-line inline entries: Context, Decision, Status. This is too shallow for AI agents — they know *what* was decided but not *why alternative X was rejected* or *what consequences followed*. When agents encounter a design question that was already settled, they either re-debate it (wasting time) or blindly follow it without understanding the constraints. The `/feature-docs` skill's ADR template includes Alternatives Considered, Consequences, and a supersession chain — exactly what's needed. This issue adds individual ADR notes as a first-class note type and upgrades `save-session` to optionally create them.

## Requirements

- New `save-decision` CLI command that creates an individual ADR note in the vault
- ADR notes use rich YAML frontmatter (type, adr number, status, supersedes/superseded_by, impacts, categories)
- ADR notes have sections: Context, Decision, Alternatives Considered, Consequences
- `decisions.md` becomes an **index** that auto-links to individual ADR notes (newest first)
- ADR numbering is auto-incremented by reading the index
- `load-context` includes a compact decision index (title + status per decision, not full ADR content)

## Implementation

### 1. Enhanced template: `src/templates/note-templates.ts`

Replace the existing `decisionNote()` function with a richer version:

```typescript
export interface ADRNoteOptions {
  project: string;
  adrNumber: number;       // auto-assigned, sequential
  title: string;           // e.g. "JWT Authentication over Session Cookies"
  date: string;
  status: "proposed" | "accepted" | "superseded" | "deprecated";
  categories?: string[];   // e.g. ["auth", "security"]
  supersedes?: number;     // ADR number this replaces
  supersededBy?: number;   // ADR number that replaced this
  impacts?: string[];      // feature slugs affected, e.g. ["auth-jwt"]
  context: string;         // what problem motivated this decision
  decision: string;        // what was decided (1-3 sentences)
  alternatives?: Array<{
    name: string;
    proscons: string;      // free-form markdown: pros, cons, why rejected
  }>;
  consequences?: string;   // what follows from this decision
}

export function adrNote(options: ADRNoteOptions): string {
  // Returns markdown with:
  // - YAML frontmatter: type: adr, project, adr (number), title, created, updated,
  //   status, categories, supersedes, superseded_by, impacts, tags
  // - # ADR-{NNN}: {title}
  // - ## Status — {status} (with supersession link if applicable)
  // - ## Context — options.context
  // - ## Decision — options.decision
  // - ## Alternatives Considered — each alternative as ### with proscons
  //   (or placeholder comment if none provided)
  // - ## Consequences — options.consequences (or placeholder comment)
  // - ## Related — wikilinks to impacted features, project context
}
```

Frontmatter shape:

```yaml
---
type: adr
project: todo-app
adr: 3
title: JWT Authentication over Session Cookies
created: 2026-03-21
updated: 2026-03-21
status: accepted
categories:
  - auth
  - security
supersedes: null
superseded_by: null
impacts:
  - auth-jwt
tags:
  - adr
  - project/todo-app
---
```

ADR note path: `Memory/Projects/{project}/ADRs/ADR-{NNN}-{slug}.md` where NNN is zero-padded to 3 digits and slug is derived from title (kebab-case, max 40 chars).

### 2. ADR numbering helper: `src/lib/adr-counter.ts`

New module for auto-incrementing ADR numbers:

```typescript
import { ObsidianCLI } from "./obsidian-cli";

/**
 * Get the next ADR number by reading existing ADR notes.
 * Scans Memory/Projects/{project}/ADRs/ for files matching ADR-NNN-*.md
 * Returns max(existing numbers) + 1, or 1 if no ADRs exist.
 */
export async function getNextADRNumber(
  cli: ObsidianCLI,
  project: string
): Promise<number> {
  try {
    const results = await cli.search("ADR-", {
      path: `Memory/Projects/${project}/ADRs/`,
    });

    let maxNumber = 0;
    for (const result of results) {
      const filename = result.path.split("/").pop() || "";
      const match = filename.match(/^ADR-(\d{3})/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }

    return maxNumber + 1;
  } catch {
    // No ADRs directory or no results — start at 1
    return 1;
  }
}

/**
 * Convert a title to a slug for the ADR filename.
 * "JWT Authentication over Session Cookies" → "jwt-auth-over-session-cookies"
 */
export function titleToSlug(title: string, maxLength = 40): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, maxLength)
    .replace(/-$/, "");
}
```

### 3. New command: `src/commands/save-decision.ts`

```typescript
export interface SaveDecisionOptions {
  title: string;           // required
  context: string;         // required — what problem motivated this
  decision: string;        // required — what was decided
  status?: string;         // default: "accepted"
  categories?: string[];
  impacts?: string[];      // feature slugs
  supersedes?: number;     // ADR number
  alternatives?: string[]; // "Name: description" format from CLI
  consequences?: string;
}

export async function runSaveDecision(
  cwd: string,
  options: SaveDecisionOptions
): Promise<{ notePath: string; adrNumber: number }> {
  // 1. findConfig(cwd) — get vault + project
  // 2. getNextADRNumber(cli, project) — auto-assign number
  // 3. Parse alternatives from "Name: description" strings
  // 4. Build ADR note content via adrNote()
  // 5. Note path: Memory/Projects/{project}/ADRs/ADR-{NNN}-{slug}.md
  // 6. cli.create() — create the note
  // 7. Update decisions.md index: prepend a line after the header comments:
  //    "- [[ADRs/ADR-{NNN}-{slug}|ADR-{NNN}: {title}]] — {status} ({date})"
  // 8. If supersedes is set, update the superseded ADR's frontmatter:
  //    read it, set superseded_by to new number, write it back
  // 9. Return { notePath, adrNumber }
}
```

### 4. CLI registration: `src/index.ts`

Add the `save-decision` command after `save-feature`:

```typescript
import { runSaveDecision } from "./commands/save-decision";

program
  .command("save-decision")
  .description("Create an Architecture Decision Record (ADR) in the memory vault")
  .requiredOption("--title <title>", "Decision title (e.g., 'JWT over Session Cookies')")
  .requiredOption("--context <text>", "What problem motivated this decision")
  .requiredOption("--decision <text>", "What was decided (1-3 sentences)")
  .option("--status <status>", "Decision status (proposed, accepted, superseded, deprecated)", "accepted")
  .option("--categories <items...>", "Decision categories/domains")
  .option("--impacts <items...>", "Feature slugs affected by this decision")
  .option("--supersedes <number>", "ADR number this decision replaces", parseInt)
  .option("--alternatives <items...>", "Alternatives in 'Name: description' format")
  .option("--consequences <text>", "What follows from this decision")
  .action(async (opts) => {
    try {
      const { notePath, adrNumber } = await runSaveDecision(process.cwd(), {
        title: opts.title,
        context: opts.context,
        decision: opts.decision,
        status: opts.status,
        categories: opts.categories,
        impacts: opts.impacts,
        supersedes: opts.supersedes,
        alternatives: opts.alternatives,
        consequences: opts.consequences,
      });
      console.log(`ADR-${String(adrNumber).padStart(3, "0")} saved: ${notePath}`);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });
```

### 5. Update vault structure: `src/lib/vault.ts`

Add the ADRs folder to the vault scaffold:

```typescript
// In getVaultStructure(), add to folders array:
`Memory/Projects/${project}/ADRs`,
```

Update the `decisions.md` file template to be an index:

```typescript
{
  path: `Memory/Projects/${project}/decisions.md`,
  content: `---
type: decisions
project: ${project}
created: ${today()}
updated: ${today()}
tags:
  - project/${project}
  - decisions
---

# Decisions — ${project}

> Architecture Decision Records. Newest first.
> Use \`obsidian-memory save-decision\` to add new decisions.

## Decision Log

<!-- New ADRs are automatically indexed here by save-decision -->

---

See also: [[Features]], [[Architecture]], [[Conventions]]
`,
}
```

### 6. Update `load-context` — `src/commands/load-context.ts`

Replace the current decisions loading (lines 54-63) with a compact index version:

```typescript
// Load decisions (compact index: title + status per decision)
if (opts.includeDecisions) {
  try {
    const decisionsDoc = await cli.read({
      path: `Memory/Projects/${project}/decisions.md`,
    });
    // Extract just the Decision Log section
    const logMatch = decisionsDoc.match(
      /## Decision Log\n([\s\S]*?)(?=\n---|\n$)/
    );
    if (logMatch && logMatch[1].trim()) {
      sections.push("## Decisions\n\n" + logMatch[1].trim());
    } else {
      // Fallback: include the whole file (backwards compat with old inline format)
      sections.push("## Decisions\n\n" + decisionsDoc);
    }
  } catch {
    // Decisions file is optional
  }
}
```

This is backwards-compatible: if `decisions.md` still uses the old inline format (no `## Decision Log` header), it falls back to including the full content.

### 7. Update AGENTS.md template: `src/templates/agents-md.ts`

Add `save-decision` to the Command Reference table:

```
| \`obsidian-memory save-decision\` | Create an Architecture Decision Record |
```

Add guidance to the "During Work" section, after the "Saving Decisions" subsection:

```markdown
### Saving Decisions

When you make a significant architectural or design decision, save it immediately:

\`\`\`bash
obsidian-memory save-decision \\
  --title "JWT over Session Cookies" \\
  --context "Need auth for the API, evaluating stateful vs stateless" \\
  --decision "Use JWT in httpOnly cookies with refresh rotation" \\
  --alternatives "Session cookies with Redis: simple revocation but requires Redis" \\
  --consequences "Stateless auth, no session store, but token revocation needs a blacklist" \\
  --impacts "auth-jwt"
\`\`\`

Include alternatives you considered and why they were rejected — this prevents future agents from re-debating settled decisions.
```

## Testing Strategy

### Unit tests: `tests/unit/adr-note-template.test.ts`

- `adrNote()` produces valid YAML frontmatter with all required fields
- `adrNote()` renders alternatives as ### subsections
- `adrNote()` with `supersedes` includes wikilink to the superseded ADR
- `adrNote()` with minimal options (only required) produces valid note
- `titleToSlug()` converts titles correctly and respects maxLength

### Unit tests: `tests/unit/adr-counter.test.ts`

- `getNextADRNumber()` returns 1 when no ADRs exist
- `getNextADRNumber()` returns max+1 when ADRs exist
- `getNextADRNumber()` handles non-sequential numbering (gaps)
- `titleToSlug()` strips special characters, respects maxLength

### Command tests: `tests/commands/save-decision.test.ts`

Follow the pattern in `tests/commands/save-session.test.ts` (mock `Bun.spawn`):

- Creates note at `Memory/Projects/{project}/ADRs/ADR-001-{slug}.md`
- Auto-increments ADR number
- Throws when no config found
- Updates decisions.md index with wikilink to new ADR
- Handles `--supersedes` flag: updates the old ADR's frontmatter

### Run: `bun test`

## Out of Scope

- Automatic decision extraction from session notes (Wave 2 enrichment agent)
- ADR status transitions via CLI (e.g., `obsidian-memory deprecate-decision`)
- Full-text search within ADR content (use `obsidian-memory search` for that)
- Migration of existing inline decisions to individual ADR notes
