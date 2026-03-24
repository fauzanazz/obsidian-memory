# Individual Feature Notes + `save-feature` Command

## Context

obsidian-memory currently tracks features as rows in a single `Features.md` table — an empty scaffold that agents are supposed to fill in manually. This produces shallow, unlinked entries. Agents reading `load-context` get a feature *name* but no understanding of what the feature does, which files implement it, what decisions shaped it, or what's known to be limited. The `/feature-docs` skill demonstrates a richer pattern: individual feature notes with structured frontmatter, prose context, key files tables, and aggressive cross-linking. This issue brings that pattern into obsidian-memory as a first-class note type and CLI command.

## Requirements

- New `save-feature` CLI command that creates an individual feature note in the vault
- Feature notes use structured YAML frontmatter (type, status, categories, related, decided_by, sessions)
- Feature notes have sections: Summary, How It Works, Key Files, Decisions & Trade-offs, Known Limitations, Related
- Features.md becomes an **index** that auto-links to individual feature notes (not an inline table)
- `load-context` includes a one-line-per-feature index (not full feature notes) for anti-duplication
- Existing `document` command continues to work — it generates the Features.md index skeleton

## Implementation

### 1. New template: `src/templates/note-templates.ts`

Add a `featureNote()` function alongside the existing `sessionNote()` and `decisionNote()`:

```typescript
export interface FeatureNoteOptions {
  project: string;
  slug: string;           // kebab-case identifier, e.g. "auth-jwt"
  title: string;          // human-readable, e.g. "JWT Authentication"
  date: string;           // YYYY-MM-DD
  status: "draft" | "in-progress" | "completed" | "deprecated";
  categories?: string[];  // e.g. ["auth", "security"]
  decidedBy?: string[];   // ADR slugs, e.g. ["ADR-003-jwt-auth"]
  sessions?: string[];    // session note names
  summary?: string;       // one-paragraph summary
  keyFiles?: Array<{ path: string; role: string }>;
  limitations?: string[];
}

export function featureNote(options: FeatureNoteOptions): string {
  // Returns markdown with:
  // - YAML frontmatter: type, project, feature, created, updated, status, categories, decided_by, related, sessions, tags
  // - # {title}
  // - ## Summary (options.summary or placeholder comment)
  // - ## How It Works (placeholder comment for agent to fill)
  // - ## Key Files (table from options.keyFiles or placeholder)
  // - ## Decisions & Trade-offs (wikilinks to decidedBy ADRs or placeholder)
  // - ## Known Limitations (options.limitations or placeholder)
  // - ## Related (wikilinks: project context, features index, related sessions)
}
```

Frontmatter shape:

```yaml
---
type: feature-note
project: todo-app
feature: auth-jwt
created: 2026-03-21
updated: 2026-03-21
status: in-progress
categories:
  - auth
  - security
decided_by:
  - ADR-003-jwt-auth
sessions:
  - 2026-03-21-claude-code-a1b2c3
tags:
  - feature
  - project/todo-app
---
```

### 2. New command: `src/commands/save-feature.ts`

```typescript
export interface SaveFeatureOptions {
  slug: string;            // required, kebab-case
  title: string;           // required, human-readable
  status?: string;         // default: "in-progress"
  categories?: string[];
  decidedBy?: string[];
  sessions?: string[];
  summary?: string;
  keyFiles?: string[];     // "path:role" format from CLI, parsed internally
  limitations?: string[];
}

export async function runSaveFeature(
  cwd: string,
  options: SaveFeatureOptions
): Promise<string> {
  // 1. findConfig(cwd) — get vault + project
  // 2. Parse keyFiles from "path:role" strings into {path, role} objects
  // 3. Build feature note content via featureNote()
  // 4. Note path: Memory/Projects/{project}/Features/{slug}.md
  // 5. cli.create() — create the note (fail if exists unless --overwrite)
  // 6. Update Features.md index: prepend a row linking to the new feature note
  //    Format: "- [[Features/{slug}|{title}]] — {status} — {one-line summary}"
  // 7. Return the created note path
}
```

The Features.md index update uses `cli.prepend()` to add a wikilink line after the table header:

```markdown
## Feature Index

- [[Features/auth-jwt|JWT Authentication]] — in-progress — Token-based auth with httpOnly cookies
- [[Features/todo-crud|Todo CRUD]] — completed — Basic CRUD endpoints for todo items
```

### 3. CLI registration: `src/index.ts`

Add the `save-feature` command between `save-session` and `search`:

```typescript
import { runSaveFeature } from "./commands/save-feature";

program
  .command("save-feature")
  .description("Create or update a feature note in the memory vault")
  .requiredOption("--slug <slug>", "Feature identifier in kebab-case (e.g., auth-jwt)")
  .requiredOption("--title <title>", "Human-readable feature name")
  .option("--status <status>", "Feature status (draft, in-progress, completed, deprecated)", "in-progress")
  .option("--categories <items...>", "Feature categories/domains")
  .option("--decided-by <items...>", "ADR slugs that shaped this feature")
  .option("--sessions <items...>", "Session note names related to this feature")
  .option("--summary <text>", "One-paragraph feature summary")
  .option("--key-files <items...>", "Key files in path:role format (e.g., src/auth.ts:JWT signing)")
  .option("--limitations <items...>", "Known limitations")
  .option("--overwrite", "Overwrite existing feature note")
  .action(async (opts) => {
    try {
      const notePath = await runSaveFeature(process.cwd(), {
        slug: opts.slug,
        title: opts.title,
        status: opts.status,
        categories: opts.categories,
        decidedBy: opts.decidedBy,
        sessions: opts.sessions,
        summary: opts.summary,
        keyFiles: opts.keyFiles,
        limitations: opts.limitations,
      });
      console.log(`Feature note saved: ${notePath}`);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });
```

### 4. Update vault structure: `src/lib/vault.ts`

Add the Features folder to the vault scaffold:

```typescript
// In getVaultStructure(), add to folders array:
`Memory/Projects/${project}/Features`,

// Add to files array — a stub Features index note:
{
  path: `Memory/Projects/${project}/Docs/Features.md`,
  content: `${frontmatter(project)}

# Features — ${project}

> Before creating new functionality, search this index first.

## Feature Index

<!-- New features are automatically added here by save-feature -->

---

See also: [[Architecture]], [[Modules]], [[Conventions]]
`,
}
```

### 5. Update `doc-generator.ts` — `generateFeatures()`

Change the empty table to a wikilink index format. The function signature stays the same, output changes:

```typescript
export function generateFeatures(project: string): string {
  return `${frontmatter(project)}

# Features — ${project}

> Before creating new functionality, search this index first.

## Feature Index

${AUTO_START("feature-index")}
<!-- Feature notes are auto-indexed here. Use save-feature to add new ones. -->
${AUTO_END("feature-index")}

## Implementation Notes
<!-- Agent: add cross-cutting notes about how features interact -->

---

See also: [[Architecture]], [[Modules]], [[Conventions]]
`;
}
```

### 6. Update `load-context` — `src/commands/load-context.ts`

After loading module docs, add a feature index section. Insert between the module docs block (line ~73) and the conventions block (line ~76):

```typescript
// Load feature index (one-liner per feature for anti-duplication)
try {
  const featuresDoc = await cli.read({
    path: `Memory/Projects/${project}/Docs/Features.md`,
  });
  // Extract just the Feature Index section (between auto markers or ## Feature Index)
  const indexMatch = featuresDoc.match(
    /## Feature Index\n([\s\S]*?)(?=\n## |---|\n$)/
  );
  if (indexMatch && indexMatch[1].trim()) {
    sections.push("## Feature Index\n\n" + indexMatch[1].trim());
  }
} catch {
  // Features doc not generated yet
}
```

### 7. Update AGENTS.md template: `src/templates/agents-md.ts`

Add `save-feature` to the Command Reference table:

```
| \`obsidian-memory save-feature\` | Save a feature note |
```

Add guidance to the "After Implementing" section:

```markdown
### After Implementing

Update the relevant documentation:
- **Save new features**: \`obsidian-memory save-feature --slug my-feature --title "My Feature" --summary "What it does"\`
- Update module descriptions if you changed a module's purpose
- Add patterns or gotchas to Conventions
- Update Architecture if you changed the system structure
```

## Testing Strategy

### Unit tests: `tests/unit/feature-note-template.test.ts`

- `featureNote()` produces valid YAML frontmatter with all required fields
- `featureNote()` includes wikilinks in Related section
- `featureNote()` renders keyFiles as a markdown table
- `featureNote()` with minimal options (only required fields) produces valid note
- `featureNote()` with all options populated renders every section

### Command tests: `tests/commands/save-feature.test.ts`

Follow the pattern in `tests/commands/save-session.test.ts` (mock `Bun.spawn`):

- Creates note at `Memory/Projects/{project}/Features/{slug}.md`
- Throws when no config found
- Includes categories in frontmatter
- Updates Features.md index with wikilink to new feature
- Passes `--overwrite` flag through to `cli.create()`

### Run: `bun test`

## Out of Scope

- Automatic feature extraction from sessions (that's Wave 2 enrichment agent)
- Feature-to-feature dependency tracking
- Feature deletion/archival commands
- Updating existing feature notes (agent does this manually via create-note --overwrite)
