# Project-Scoped Session Directories

## Context

Sessions from all projects are stored in a single flat `Memory/Sessions/` directory. The only isolation mechanism is a keyword search for the project name when loading context or consolidating. This is fragile — if project A's session note mentions project B's name in its content, it leaks into project B's context via `load-context`. Sessions need structural isolation so that project A's sessions never appear in project B's context.

## Requirements

- Session notes must be stored in project-specific subdirectories: `Memory/Sessions/{project}/`
- `save-session` must write to the project-scoped directory
- `load-context` must only read sessions from the current project's directory
- `consolidate` must only process sessions from the current project's directory
- `init` must create the project-specific sessions directory when scaffolding the vault
- Existing tests must be updated to reflect the new path structure

## Implementation

### 1. Update vault structure — `src/lib/vault.ts`

Add the project-specific sessions folder to `getVaultStructure()`:

```typescript
// src/lib/vault.ts — getVaultStructure()
// Line 29: Add to the folders array
export function getVaultStructure(project: string): VaultStructure {
  const folders = [
    ...VAULT_FOLDERS,
    `Memory/Projects/${project}`,
    `Memory/Projects/${project}/Docs`,
    `Memory/Sessions/${project}`,  // ← ADD THIS LINE
  ];
  // ... rest unchanged
}
```

No changes to `VAULT_FOLDERS` constant — `Memory/Sessions/` still exists as the parent.

### 2. Update save-session — `src/commands/save-session.ts`

Change the session note path to include the project name:

```typescript
// src/commands/save-session.ts — runSaveSession()
// Line 31: Change the noteName to include project
const noteName = `Memory/Sessions/${project}/${date}-${options.agent}-${hash}`;
//                                 ^^^^^^^^^^^ ADD project segment
```

**Before:** `Memory/Sessions/2026-03-22-claude-code-a1b2c3`
**After:** `Memory/Sessions/test-app/2026-03-22-claude-code-a1b2c3`

No other changes in this file — the progress.md prepend link still works because the wikilink resolves by note name, not full path.

### 3. Update load-context — `src/commands/load-context.ts`

Change the session search to use the project-scoped directory and a generic query:

```typescript
// src/commands/load-context.ts — runLoadContext()
// Lines 96-100: Change search path and query
const results = await cli.search("session", {
  path: `Memory/Sessions/${project}/`,
  //                       ^^^^^^^^^^^ scope to project dir
  limit: opts.includeSessions,
});
```

**Key change:** The search query changes from `project` (the project name) to `"session"` (matches `type: session` in every session note's frontmatter). This is safe because the directory already scopes to the correct project — we just need to find all notes in it. The query `"session"` will match every session note.

### 4. Update consolidate — `src/commands/consolidate.ts`

Same scoping change as load-context:

```typescript
// src/commands/consolidate.ts — runConsolidate()
// Lines 32-34: Change search path and query
const results = await cli.search("session", {
  path: `Memory/Sessions/${project}/`,
  //                       ^^^^^^^^^^^ scope to project dir
});
```

The filename date-parsing regex on line 52-53 still works because `.split("/").pop()` extracts just the filename:

```
Memory/Sessions/test-app/2026-03-22-claude-code-hash.md
                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ .pop() gets this
```

The existing regex `filename.match(/^(\d{4}-\d{2}-\d{2})/)` remains correct.

### 5. Update tests

#### `tests/commands/save-session.test.ts`

```typescript
// Line 62: Update regex to match new path with project segment
expect(result).toMatch(
  /^Memory\/Sessions\/test-app\/\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/
  //                  ^^^^^^^^^ matches the project name from config
);
```

#### `tests/commands/load-context.test.ts`

```typescript
// Line 73: Update mock to check for project-scoped search path
// The search mock should verify the path arg contains the project name
if (args.includes("search")) {
  // Verify search is scoped to project directory
  const pathArg = args.find((a: string) => a.startsWith("path="));
  // pathArg should be "path=Memory/Sessions/my-app/"
  return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
}
```

### Summary of all changes

| File | Change |
|------|--------|
| `src/lib/vault.ts` | Add `Memory/Sessions/${project}` to `getVaultStructure()` folders array |
| `src/commands/save-session.ts` | Change `noteName` path: add `/${project}/` segment |
| `src/commands/load-context.ts` | Change search path to `Memory/Sessions/${project}/`, query to `"session"` |
| `src/commands/consolidate.ts` | Change search path to `Memory/Sessions/${project}/`, query to `"session"` |
| `tests/commands/save-session.test.ts` | Update path regex to include `test-app/` segment |
| `tests/commands/load-context.test.ts` | Update mock assertions for new search path |

### Data flow — save-session

```
runSaveSession(cwd, { agent: "claude-code", summary: "..." })
  → findConfig(cwd) → { vault: "DevMemory", project: "my-app" }
  → noteName = "Memory/Sessions/my-app/2026-03-23-claude-code-a1b2c3"
  → cli.create({ name: noteName, content: ... })
  → cli.prepend progress.md with link
```

### Data flow — load-context (sessions section)

```
runLoadContext(cwd, { includeSessions: 3 })
  → findConfig(cwd) → { vault: "DevMemory", project: "my-app" }
  → cli.search("session", { path: "Memory/Sessions/my-app/", limit: 3 })
  → reads each result → appends to sections
```

### Vault structure — before vs after

**Before:**
```
Memory/
  Sessions/
    2026-03-22-claude-code-b15348.md   ← project: claude-harness
    2026-03-22-claude-code-7e28e4.md   ← project: obsidian-memory
    2026-03-21-claude-code-3cb96b.md   ← project: obsidian-memory
```

**After:**
```
Memory/
  Sessions/
    claude-harness/
      2026-03-22-claude-code-b15348.md
    obsidian-memory/
      2026-03-22-claude-code-7e28e4.md
      2026-03-21-claude-code-3cb96b.md
```

## Testing Strategy

Run the existing test suite after changes:

```bash
cd /Users/enjat/Github/obsidian-memory
bun test
```

Specific test files to verify:
- `bun test tests/commands/save-session.test.ts` — verify new path format
- `bun test tests/commands/load-context.test.ts` — verify project-scoped search
- `bun test tests/lib/vault.test.ts` — verify new folder in vault structure

Manual smoke test:
```bash
# From any project with .obsidian-memory.json
obsidian-memory save-session --agent claude-code --summary "Test scoped session"
# Verify note created at Memory/Sessions/{project}/... in the vault
obsidian-memory load-context --sessions 1
# Verify only current project's sessions appear
```

## Out of Scope

- **Migration of existing flat sessions** — Existing notes in `Memory/Sessions/` stay where they are. They won't appear in project-scoped queries (since the search path is now `Memory/Sessions/{project}/`). A separate migration command could move them based on frontmatter `project:` tag, but that's a follow-up task.
- **Cross-project session search** — The `search` command already searches the entire `Memory/` tree, so it can still find sessions across projects. No changes needed there.
- **Journal consolidation path changes** — `Memory/Journal/{month}.md` remains shared across projects. If project-scoped journals are desired, that's a separate feature.
