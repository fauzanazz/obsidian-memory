# Design: Project Documentation Feature

## Overview

Add `obsidian-memory document` command + AGENTS.md documentation protocol to solve three problems on large codebases: feature duplication, blind debugging exploration, and architecture amnesia.

## Architecture

### Two-Part Solution

1. **CLI command** (`obsidian-memory document`) — static scan of the project file tree, detects entry points and module boundaries, creates 4 skeleton doc notes in the vault
2. **AGENTS.md protocol** — "Documentation Protocol" section that strongly recommends agents check docs before creating, read docs before debugging, and update docs after implementing

### Data Flow

```
obsidian-memory document
  |
  +-- Scanner (src/lib/scanner.ts)
  |     Walk file tree via `git ls-files` (respects .gitignore)
  |     Fallback to manual walk with exclusion list if not a git repo
  |
  +-- ProjectDetector (src/lib/project-detector.ts)
  |     Parse package.json (main, bin, scripts)
  |     Parse tsconfig.json (paths, outDir)
  |     Parse pyproject.toml (Python projects)
  |     Detect module boundaries (dirs with index.ts/index.js/__init__.py/mod.rs)
  |
  +-- DocGenerator (src/lib/doc-generator.ts)
  |     Generate content for 4 doc notes
  |     Handle merge with existing content (section markers)
  |
  +-- ObsidianCLI (existing)
        Create/update notes in vault
```

### Vault Structure

```
Memory/Projects/{project}/Docs/
  +-- Architecture.md    — file tree, entry points, system overview
  +-- Features.md        — feature inventory (anti-duplication index)
  +-- Modules.md         — file/dir -> purpose mapping (debugging index)
  +-- Conventions.md     — patterns, naming, gotchas
```

### Idempotent Updates (Section Markers)

Auto-generated content is wrapped in markers so re-running `document` updates the scan data without destroying agent-written content:

```markdown
<!-- obsidian-memory:auto-start:structure -->
(auto-generated file tree — replaced on re-run)
<!-- obsidian-memory:auto-end:structure -->

## System Overview
(agent-written content — preserved on re-run)
```

### load-context Integration

When docs exist, `load-context` includes Modules.md content (most useful for debugging and anti-duplication). Other docs are available via `obsidian-memory search`.

## Implementation Tasks

### Task 1: File Tree Scanner (`src/lib/scanner.ts`)

New module that walks the project file tree.

- Primary: use `git ls-files` to get tracked files (automatically respects .gitignore)
- Fallback: if not a git repo, walk with exclusion list (node_modules, .git, dist, build, __pycache__, .next, .venv, etc.)
- Output: `ScanResult` — flat list of file paths + directory tree structure
- Build tree structure from flat file list for rendering

```typescript
interface ScanResult {
  files: string[];           // flat list of all tracked files
  tree: DirectoryNode;       // nested tree structure
  rootDir: string;           // project root
}

interface DirectoryNode {
  name: string;
  children: DirectoryNode[];
  files: string[];           // files in this directory (names only)
}
```

### Task 2: Project Detector (`src/lib/project-detector.ts`)

Detects entry points and module boundaries from scan results.

- Parse `package.json`: main, bin, scripts, type
- Parse `tsconfig.json`: paths, outDir, rootDir
- Parse `pyproject.toml`: if present, detect Python project
- Detect module boundaries: directories containing index.ts, index.js, __init__.py, mod.rs
- Count exports per module (simple regex: `export` keyword count in entry files)

```typescript
interface ProjectInfo {
  type: "node" | "python" | "rust" | "unknown";
  entryPoints: EntryPoint[];
  modules: ModuleInfo[];
}

interface EntryPoint {
  path: string;
  source: string;  // "package.json:main", "package.json:bin", etc.
}

interface ModuleInfo {
  directory: string;
  entryFile: string;
  exportCount: number;
  fileCount: number;
}
```

### Task 3: Document Generator (`src/lib/doc-generator.ts`)

Generates content for the 4 documentation notes.

- `generateArchitecture(project, scan, info)` — file tree + entry points + empty sections for agent
- `generateFeatures(project)` — empty feature inventory table + instructions
- `generateModules(project, info)` — module index table (pre-populated) + empty details section
- `generateConventions(project)` — empty template with section prompts
- `mergeWithExisting(newContent, existingContent)` — replace auto sections, preserve agent-written content

Each note has:
- YAML frontmatter (type: documentation, project, created, updated, tags)
- Wikilinks to sibling docs
- Auto-generated sections (between markers)
- Agent-writable sections (outside markers)

### Task 4: CLI Command (`src/commands/document.ts`)

Wire up `obsidian-memory document` command.

- Reads config via `findConfig()`
- Runs scanner on project root
- Runs project detector on scan results
- Generates doc content
- Creates or updates notes via ObsidianCLI
- Handles merge with existing content for idempotent re-runs

Options:
- `--force` — overwrite existing docs entirely (ignore section markers)

Output: summary of what was created/updated.

### Task 5: Vault Structure Update (`src/lib/vault.ts`)

- Add `Memory/Projects/{project}/Docs` to `VAULT_FOLDERS` pattern
- Add doc template stubs to `getVaultStructure()` (optional — `document` command creates the real ones)

### Task 6: AGENTS.md Protocol Update (`src/templates/agents-md.ts`)

Add "Documentation Protocol" section to the generated AGENTS.md template:

```markdown
## Documentation Protocol

This project maintains structured documentation in the memory vault to prevent duplication
and enable surgical debugging. The documentation is generated by `obsidian-memory document`
and maintained by agents during sessions.

### Before Creating New Code

Search the feature inventory and module index before implementing anything new:

\`\`\`bash
obsidian-memory search "feature name or concept"
\`\`\`

If the feature already exists, work with the existing implementation instead of creating a duplicate.

### Before Debugging

Read the module index to know exactly where to look:

\`\`\`bash
obsidian-memory search "module or area related to the bug"
\`\`\`

The Modules documentation maps directories to their purpose and entry points — use it to go
straight to the right file instead of exploring blindly.

### After Implementing

Update the relevant documentation:
- Add new features to the Features inventory
- Update module descriptions if you changed a module's purpose
- Add patterns or gotchas to Conventions
- Update Architecture if you changed the system structure
```

### Task 7: load-context Integration (`src/commands/load-context.ts`)

- After loading project context, attempt to read `Memory/Projects/{project}/Docs/Modules.md`
- If found, include its content as a "## Module Documentation" section
- Add pointer text mentioning other docs are available via search

### Task 8: Command Registration (`src/index.ts`)

- Import and register the `document` command in the Commander.js program
- Add to command reference table in AGENTS.md template

### Task 9: Tests

- Unit tests for scanner (mock file list, test tree building)
- Unit tests for project detector (mock package.json, tsconfig, etc.)
- Unit tests for doc generator (content generation, merge logic)
- Unit tests for section marker merge (preserve agent content, replace auto content)
- CLI integration test for `document` command
- Integration test for load-context with docs present
