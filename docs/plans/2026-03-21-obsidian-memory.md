# Obsidian Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `obsidian-memory` -- a CLI setup tool + AGENTS.md memory protocol that gives AI coding agents persistent, searchable memory via an Obsidian vault and the official Obsidian CLI.

**Architecture:** No MCP server. Agents use shell to run Obsidian CLI directly. The product is: (1) an `npx obsidian-memory init` setup wizard that creates vault structure + agent configs, (2) an AGENTS.md memory protocol file that teaches agents how/when to read/write memory, (3) vault templates with standardized frontmatter. Optional `obsidian-hybrid-search` enhances keyword search with semantic search.

**Tech Stack:** TypeScript, Node.js 18+, Commander.js (CLI), Inquirer.js (interactive prompts), Vitest (tests), tsup (bundling), npm (distribution)

**Spec:** `.planning/spec.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (CLI entry point, stub)

**Step 1: Initialize git repo**

```bash
git init
```

**Step 2: Create package.json**

```json
{
  "name": "obsidian-memory",
  "version": "0.1.0",
  "description": "Persistent AI agent memory using Obsidian vaults",
  "type": "module",
  "bin": {
    "obsidian-memory": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "dev": "tsup src/index.ts --format esm --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "keywords": ["obsidian", "memory", "ai-agent", "claude-code", "cursor", "mcp"],
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Step 3: Install dependencies**

```bash
npm install commander inquirer chalk ora
npm install -D typescript vitest tsup @types/node @types/inquirer
```

**Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

**Step 6: Create stub entry point**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("obsidian-memory")
  .description("Persistent AI agent memory using Obsidian vaults")
  .version("0.1.0");

program
  .command("init")
  .description("Set up Obsidian Memory vault and agent configurations")
  .action(() => {
    console.log("obsidian-memory init -- not yet implemented");
  });

program.parse();
```

**Step 7: Build and verify**

```bash
npm run build
node dist/index.js --help
```

Expected: Help text with `init` command listed.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with CLI stub"
```

---

## Task 2: Vault Structure Templates

**Files:**
- Create: `src/templates/vault-structure.ts` (defines folder hierarchy + template note contents)
- Test: `src/__tests__/vault-structure.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/vault-structure.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { VAULT_FOLDERS, TEMPLATE_NOTES, getTemplateContent } from "../templates/vault-structure.js";

describe("vault-structure", () => {
  it("defines all required Memory/ subdirectories", () => {
    const requiredFolders = [
      "Memory",
      "Memory/Projects",
      "Memory/Conventions",
      "Memory/Decisions",
      "Memory/Sessions",
      "Memory/Journal",
      "Memory/Templates",
    ];
    for (const folder of requiredFolders) {
      expect(VAULT_FOLDERS).toContain(folder);
    }
  });

  it("defines template notes with valid frontmatter", () => {
    expect(TEMPLATE_NOTES.length).toBeGreaterThan(0);
    for (const template of TEMPLATE_NOTES) {
      expect(template.path).toBeTruthy();
      expect(template.content).toContain("---"); // has frontmatter
    }
  });

  it("generates project context template with project name", () => {
    const content = getTemplateContent("project-context", { projectName: "my-app" });
    expect(content).toContain("my-app");
    expect(content).toContain("type: project-context");
  });

  it("generates session template with agent and project", () => {
    const content = getTemplateContent("session", {
      agent: "claude-code",
      projectName: "my-app",
      date: "2026-03-21",
    });
    expect(content).toContain("agent: claude-code");
    expect(content).toContain("project: my-app");
    expect(content).toContain("2026-03-21");
  });

  it("generates decision template", () => {
    const content = getTemplateContent("decision", {
      projectName: "my-app",
      title: "Use PostgreSQL",
      date: "2026-03-21",
    });
    expect(content).toContain("type: decision");
    expect(content).toContain("Use PostgreSQL");
  });

  it("generates handoff template with agent", () => {
    const content = getTemplateContent("handoff", {
      agent: "cursor",
      projectName: "my-app",
      date: "2026-03-21",
    });
    expect(content).toContain("type: handoff");
    expect(content).toContain("agent: cursor");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/vault-structure.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/templates/vault-structure.ts`:

```typescript
export const VAULT_FOLDERS = [
  "Memory",
  "Memory/Projects",
  "Memory/Conventions",
  "Memory/Decisions",
  "Memory/Sessions",
  "Memory/Journal",
  "Memory/Templates",
];

interface TemplateNote {
  path: string;
  content: string;
}

export const TEMPLATE_NOTES: TemplateNote[] = [
  {
    path: "Memory/Index.md",
    content: `---
type: index
created: {{date}}
updated: {{date}}
tags: [memory, index]
---

# Memory Index

Welcome to your AI agent memory vault. This vault stores persistent context, decisions, and session logs that your AI coding agents can read and write.

## Structure

- [[Projects]] -- Per-project context, conventions, and progress
- [[Decisions]] -- Architecture Decision Records
- [[Sessions]] -- Timestamped session summaries from each agent
- [[Journal]] -- Monthly append-only insight log
- [[Conventions]] -- Shared coding standards across projects

## How It Works

Your AI agents read the AGENTS.md file in your project directory. That file teaches them:
1. How to load context from this vault at session start
2. How to save session summaries when finishing work
3. How to search for relevant past decisions and context
4. How to hand off work to another agent seamlessly
`,
  },
  {
    path: "Memory/Conventions/coding-standards.md",
    content: `---
type: convention
created: {{date}}
updated: {{date}}
tags: [memory, convention, coding-standards]
---

# Coding Standards

Add your shared coding standards here. AI agents will reference this note when working on any project.

## Style
- (Add your preferences)

## Naming
- (Add your conventions)

## Error Handling
- (Add your patterns)
`,
  },
  {
    path: "Memory/Conventions/git-workflow.md",
    content: `---
type: convention
created: {{date}}
updated: {{date}}
tags: [memory, convention, git]
---

# Git Workflow

## Commit Convention
- (e.g., Conventional Commits: feat, fix, chore, docs)

## Branch Strategy
- (e.g., feature branches off main)

## PR Process
- (Add your workflow)
`,
  },
];

type TemplateType = "project-context" | "session" | "decision" | "handoff";

interface TemplateVars {
  projectName?: string;
  agent?: string;
  date?: string;
  title?: string;
}

export function getTemplateContent(type: TemplateType, vars: TemplateVars): string {
  const date = vars.date || new Date().toISOString().split("T")[0];

  switch (type) {
    case "project-context":
      return `---
type: project-context
project: ${vars.projectName || "unnamed"}
created: ${date}
updated: ${date}
tags: [memory, project, ${vars.projectName || "unnamed"}]
---

# ${vars.projectName || "Project"} -- Context

## Tech Stack
- (Language, framework, database, etc.)

## Architecture
- (Key patterns, folder structure, etc.)

## Conventions
- (Project-specific rules beyond global conventions)

## Current State
- (What's done, what's in progress, what's next)

## Key Decisions
- (Link to decision notes in Memory/Decisions/)
`;

    case "session":
      return `---
type: session
agent: ${vars.agent || "unknown"}
project: ${vars.projectName || "unnamed"}
created: ${date}
updated: ${date}
tags: [memory, session, ${vars.agent || "unknown"}, ${vars.projectName || "unnamed"}]
---

# Session -- ${date} -- ${vars.agent || "unknown"}

## Summary
(What was accomplished this session)

## Decisions Made
- (Key decisions with rationale)

## Changes
- (Files modified, features added, bugs fixed)

## Open Items
- (Todos, blockers, questions for next session)

## Handoff Notes
(Context needed for the next agent to continue this work)
`;

    case "decision":
      return `---
type: decision
project: ${vars.projectName || "unnamed"}
title: ${vars.title || "Untitled Decision"}
status: accepted
created: ${date}
updated: ${date}
tags: [memory, decision, ${vars.projectName || "unnamed"}]
---

# Decision: ${vars.title || "Untitled"}

## Context
(What situation prompted this decision?)

## Options Considered
1. **Option A** -- (pros/cons)
2. **Option B** -- (pros/cons)

## Decision
(What we chose and why)

## Consequences
(What changes as a result of this decision)
`;

    case "handoff":
      return `---
type: handoff
agent: ${vars.agent || "unknown"}
project: ${vars.projectName || "unnamed"}
created: ${date}
updated: ${date}
tags: [memory, handoff, ${vars.agent || "unknown"}, ${vars.projectName || "unnamed"}]
---

# Handoff -- ${vars.agent || "unknown"} -- ${date}

## Current State
(What's done, what's in progress)

## Active Files
- (Files being worked on and their state)

## Key Decisions This Session
- (Decisions made with rationale)

## Blockers / Questions
- (Anything unresolved)

## Next Steps
1. (Priority-ordered list of what to do next)

## How to Verify
(Commands to run to check current state: tests, build, etc.)
`;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/vault-structure.test.ts
```

Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: vault structure templates with frontmatter schemas"
```

---

## Task 3: AGENTS.md Memory Protocol

**Files:**
- Create: `src/templates/agents-md.ts` (generates the AGENTS.md content)
- Test: `src/__tests__/agents-md.test.ts`

This is the most important file in the project. It teaches all AI agents how to use the Obsidian CLI for memory operations.

**Step 1: Write the failing test**

Create `src/__tests__/agents-md.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateAgentsMd } from "../templates/agents-md.js";

describe("agents-md", () => {
  const vaultName = "ObsidianMemory";

  it("includes vault name in CLI commands", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain(`vault="${vaultName}"`);
  });

  it("includes session start protocol", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain("Session Start");
    expect(content).toContain("obsidian read");
    expect(content).toContain("obsidian search");
  });

  it("includes session end protocol", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain("Session End");
    expect(content).toContain("obsidian create");
    expect(content).toContain("obsidian append");
  });

  it("includes handoff protocol", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain("Handoff");
    expect(content).toContain("handoff");
  });

  it("includes consolidation instructions", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain("Consolidat");
  });

  it("includes hybrid search commands when available", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: true });
    expect(content).toContain("obsidian-hybrid-search");
  });

  it("falls back to keyword search when hybrid search unavailable", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain("obsidian search");
    expect(content).not.toContain("obsidian-hybrid-search");
  });

  it("includes all CRUD operations with correct vault targeting", () => {
    const content = generateAgentsMd({ vaultName, hybridSearchAvailable: false });
    expect(content).toContain("obsidian read");
    expect(content).toContain("obsidian create");
    expect(content).toContain("obsidian append");
    expect(content).toContain("obsidian search");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/agents-md.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/templates/agents-md.ts`. This is the core memory protocol -- the AGENTS.md that all five agents read.

The content should be a function that generates the full AGENTS.md markdown string. The protocol must include:

1. **Memory System Overview** -- What this is, where notes live, how to use the Obsidian CLI
2. **Session Start Protocol** -- Load project context, check for handoff notes, read recent sessions
3. **During Work** -- How to save decisions, conventions, progress
4. **Session End Protocol** -- Save session summary, update project context, write handoff if switching agents
5. **Search Protocol** -- Keyword search (always available) + semantic search (if hybrid-search installed)
6. **Consolidation Protocol** -- When and how to merge/dedup memory notes
7. **CLI Command Reference** -- Quick reference for the obsidian CLI commands agents need

The function signature: `generateAgentsMd(config: { vaultName: string; hybridSearchAvailable: boolean }): string`

Key details for the implementation:
- All `obsidian` CLI commands must include `vault="${vaultName}"` as the first parameter
- Frontmatter must match the schemas from Task 2 (type, project, agent, created, updated, tags)
- Session notes go in `Memory/Sessions/{YYYY-MM-DD}-{agent}-{summary-slug}.md`
- Handoff notes go in `Memory/Projects/{project}/handoff.md` (overwritten each time)
- Decision notes go in `Memory/Decisions/{YYYY-MM-DD}-{decision-slug}.md`
- Journal entries get appended to `Memory/Journal/{YYYY-MM}.md`
- The keyword search fallback uses `obsidian search query="..." vault="..." format=json`
- The hybrid search path uses `obsidian-hybrid-search search "..." --vault /path/to/vault`
- Consolidation: instruct agents to review sessions older than 7 days, merge overlapping notes, delete originals
- Instruct agents to check if Obsidian is running before operations (try `obsidian version` first)

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/agents-md.test.ts
```

Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: AGENTS.md memory protocol generator"
```

---

## Task 4: Agent-Specific Config Generators

**Files:**
- Create: `src/templates/agent-configs.ts` (generates per-agent config files)
- Test: `src/__tests__/agent-configs.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/agent-configs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  generateClaudeMd,
  generateCursorRule,
  generateGeminiMd,
  generateOpenCodeConfig,
  generateForgeConfig,
  SUPPORTED_AGENTS,
  type AgentId,
} from "../templates/agent-configs.js";

describe("agent-configs", () => {
  it("lists all five supported agents", () => {
    const ids: AgentId[] = ["claude-code", "cursor", "antigravity", "opencode", "forgecode"];
    for (const id of ids) {
      expect(SUPPORTED_AGENTS.find((a) => a.id === id)).toBeTruthy();
    }
  });

  describe("Claude Code", () => {
    it("generates CLAUDE.md that imports AGENTS.md", () => {
      const content = generateClaudeMd();
      expect(content).toContain("@AGENTS.md");
    });
  });

  describe("Cursor", () => {
    it("generates .cursor/rules/memory.mdc with alwaysApply frontmatter", () => {
      const content = generateCursorRule();
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain("AGENTS.md");
    });
  });

  describe("Antigravity", () => {
    it("generates GEMINI.md referencing AGENTS.md", () => {
      const content = generateGeminiMd();
      expect(content).toContain("AGENTS.md");
    });
  });

  describe("OpenCode", () => {
    it("generates opencode.json snippet with instructions field", () => {
      const config = generateOpenCodeConfig();
      expect(config.instructions).toContain("AGENTS.md");
    });
  });

  describe("ForgeCode", () => {
    it("generates forge.yaml snippet with custom_rules referencing AGENTS.md", () => {
      const content = generateForgeConfig();
      expect(content).toContain("AGENTS.md");
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/agent-configs.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/templates/agent-configs.ts`:

Each generator produces the content for that agent's config file. Details:

- **`generateClaudeMd()`**: Returns a CLAUDE.md string that uses `@AGENTS.md` import syntax to pull in the memory protocol. Adds Claude-specific notes (e.g., use `/memory` for Claude's own auto-memory, but primary memory goes to Obsidian vault).
- **`generateCursorRule()`**: Returns a `.cursor/rules/memory.mdc` file with YAML frontmatter (`alwaysApply: true`, `description: "Obsidian Memory protocol"`) and body instructing Cursor to read AGENTS.md for the full protocol.
- **`generateGeminiMd()`**: Returns a GEMINI.md string that references AGENTS.md and adds Antigravity-specific notes (e.g., Knowledge Items integration note).
- **`generateOpenCodeConfig()`**: Returns an object `{ instructions: string[] }` that can be merged into opencode.json, pointing to AGENTS.md.
- **`generateForgeConfig()`**: Returns a YAML string snippet for forge.yaml's `custom_rules` field referencing AGENTS.md.
- **`SUPPORTED_AGENTS`**: Array of `{ id, name, detectPaths, configPath, generator }` for the init wizard to use.

Detection paths for each agent:
- Claude Code: `.claude/` directory or `CLAUDE.md` file
- Cursor: `.cursor/` directory or `.cursorrules` file
- Antigravity: `GEMINI.md` file
- OpenCode: `.opencode/` directory or `opencode.json` file
- ForgeCode: `forge.yaml` file

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/agent-configs.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: agent-specific config generators for all five agents"
```

---

## Task 5: Agent Detection Utility

**Files:**
- Create: `src/utils/detect-agents.ts`
- Test: `src/__tests__/detect-agents.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/detect-agents.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectInstalledAgents } from "../utils/detect-agents.js";

describe("detectInstalledAgents", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `obsidian-memory-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("detects Claude Code when .claude/ directory exists", () => {
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    const agents = detectInstalledAgents(testDir);
    expect(agents).toContain("claude-code");
  });

  it("detects Cursor when .cursor/ directory exists", () => {
    mkdirSync(join(testDir, ".cursor"), { recursive: true });
    const agents = detectInstalledAgents(testDir);
    expect(agents).toContain("cursor");
  });

  it("detects Antigravity when GEMINI.md exists", () => {
    writeFileSync(join(testDir, "GEMINI.md"), "# Gemini");
    const agents = detectInstalledAgents(testDir);
    expect(agents).toContain("antigravity");
  });

  it("detects OpenCode when .opencode/ directory exists", () => {
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    const agents = detectInstalledAgents(testDir);
    expect(agents).toContain("opencode");
  });

  it("detects ForgeCode when forge.yaml exists", () => {
    writeFileSync(join(testDir, "forge.yaml"), "model: claude");
    const agents = detectInstalledAgents(testDir);
    expect(agents).toContain("forgecode");
  });

  it("returns empty array when no agents detected", () => {
    const agents = detectInstalledAgents(testDir);
    expect(agents).toEqual([]);
  });

  it("detects multiple agents", () => {
    mkdirSync(join(testDir, ".claude"), { recursive: true });
    mkdirSync(join(testDir, ".cursor"), { recursive: true });
    writeFileSync(join(testDir, "forge.yaml"), "model: claude");
    const agents = detectInstalledAgents(testDir);
    expect(agents).toHaveLength(3);
    expect(agents).toContain("claude-code");
    expect(agents).toContain("cursor");
    expect(agents).toContain("forgecode");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/detect-agents.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/utils/detect-agents.ts`:

Function `detectInstalledAgents(projectDir: string): AgentId[]` that checks for the existence of each agent's indicator files/directories using `fs.existsSync`. Returns an array of detected agent IDs.

Detection rules (check in order, first match wins per agent):
- `claude-code`: `.claude/` dir OR `CLAUDE.md` file
- `cursor`: `.cursor/` dir OR `.cursorrules` file
- `antigravity`: `GEMINI.md` file
- `opencode`: `.opencode/` dir OR `opencode.json` OR `opencode.jsonc`
- `forgecode`: `forge.yaml` file

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/detect-agents.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: agent detection utility"
```

---

## Task 6: Obsidian CLI Availability Check

**Files:**
- Create: `src/utils/check-obsidian.ts`
- Test: `src/__tests__/check-obsidian.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/check-obsidian.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { checkObsidianCli, checkHybridSearch } from "../utils/check-obsidian.js";

describe("checkObsidianCli", () => {
  it("returns an object with available and version fields", async () => {
    const result = await checkObsidianCli();
    expect(result).toHaveProperty("available");
    expect(result).toHaveProperty("version");
    expect(typeof result.available).toBe("boolean");
  });
});

describe("checkHybridSearch", () => {
  it("returns a boolean indicating availability", async () => {
    const result = await checkHybridSearch();
    expect(typeof result).toBe("boolean");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/check-obsidian.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/utils/check-obsidian.ts`:

- `checkObsidianCli()`: Runs `obsidian version` via `child_process.execSync`. Returns `{ available: boolean, version: string | null }`. Catches errors gracefully (returns `{ available: false, version: null }`).
- `checkHybridSearch()`: Runs `npx obsidian-hybrid-search --version` (or `which obsidian-hybrid-search`). Returns boolean.

Both functions use `execSync` wrapped in try/catch with a 5-second timeout.

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/check-obsidian.test.ts
```

Expected: All tests PASS (both return false on this machine since neither is installed, but the interface contract is satisfied).

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: Obsidian CLI and hybrid search availability checks"
```

---

## Task 7: Vault Creator Utility

**Files:**
- Create: `src/utils/create-vault.ts`
- Test: `src/__tests__/create-vault.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/create-vault.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault } from "../utils/create-vault.js";

describe("createVault", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `obsidian-memory-vault-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates the vault root directory", () => {
    createVault(testDir);
    expect(existsSync(testDir)).toBe(true);
  });

  it("creates all Memory/ subdirectories", () => {
    createVault(testDir);
    const expectedDirs = [
      "Memory",
      "Memory/Projects",
      "Memory/Conventions",
      "Memory/Decisions",
      "Memory/Sessions",
      "Memory/Journal",
      "Memory/Templates",
    ];
    for (const dir of expectedDirs) {
      expect(existsSync(join(testDir, dir))).toBe(true);
    }
  });

  it("creates Index.md with frontmatter", () => {
    createVault(testDir);
    const indexPath = join(testDir, "Memory", "Index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("type: index");
    expect(content).toContain("# Memory Index");
  });

  it("creates convention template notes", () => {
    createVault(testDir);
    expect(existsSync(join(testDir, "Memory", "Conventions", "coding-standards.md"))).toBe(true);
    expect(existsSync(join(testDir, "Memory", "Conventions", "git-workflow.md"))).toBe(true);
  });

  it("is idempotent -- running twice does not error", () => {
    createVault(testDir);
    expect(() => createVault(testDir)).not.toThrow();
  });

  it("does not overwrite existing files on second run", () => {
    createVault(testDir);
    const indexPath = join(testDir, "Memory", "Index.md");
    const originalContent = readFileSync(indexPath, "utf-8");
    // Modify the file
    const { writeFileSync } = require("node:fs");
    writeFileSync(indexPath, "# Custom content");
    // Run again
    createVault(testDir);
    // Should NOT overwrite
    const afterContent = readFileSync(indexPath, "utf-8");
    expect(afterContent).toBe("# Custom content");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/create-vault.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/utils/create-vault.ts`:

Function `createVault(vaultPath: string): void`:
1. Create the vault root directory (`mkdirSync recursive`)
2. Create all subdirectories from `VAULT_FOLDERS`
3. Write each template note from `TEMPLATE_NOTES`, replacing `{{date}}` with today's date
4. **Do not overwrite existing files** -- check `existsSync` before writing each file

Import `VAULT_FOLDERS` and `TEMPLATE_NOTES` from `../templates/vault-structure.js`.

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/create-vault.test.ts
```

Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: vault creator utility with idempotent file creation"
```

---

## Task 8: Agent Config Writer Utility

**Files:**
- Create: `src/utils/write-agent-configs.ts`
- Test: `src/__tests__/write-agent-configs.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/write-agent-configs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeAgentConfigs } from "../utils/write-agent-configs.js";
import type { AgentId } from "../templates/agent-configs.js";

describe("writeAgentConfigs", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `obsidian-memory-configs-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes AGENTS.md to project root", () => {
    writeAgentConfigs(testDir, ["claude-code"], { vaultName: "TestVault", hybridSearchAvailable: false });
    expect(existsSync(join(testDir, "AGENTS.md"))).toBe(true);
    const content = readFileSync(join(testDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("TestVault");
  });

  it("writes CLAUDE.md for claude-code", () => {
    writeAgentConfigs(testDir, ["claude-code"], { vaultName: "TestVault", hybridSearchAvailable: false });
    expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true);
  });

  it("writes .cursor/rules/memory.mdc for cursor", () => {
    writeAgentConfigs(testDir, ["cursor"], { vaultName: "TestVault", hybridSearchAvailable: false });
    expect(existsSync(join(testDir, ".cursor", "rules", "memory.mdc"))).toBe(true);
  });

  it("writes GEMINI.md for antigravity", () => {
    writeAgentConfigs(testDir, ["antigravity"], { vaultName: "TestVault", hybridSearchAvailable: false });
    expect(existsSync(join(testDir, "GEMINI.md"))).toBe(true);
  });

  it("writes configs for multiple agents at once", () => {
    const agents: AgentId[] = ["claude-code", "cursor", "forgecode"];
    writeAgentConfigs(testDir, agents, { vaultName: "TestVault", hybridSearchAvailable: false });
    expect(existsSync(join(testDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(testDir, ".cursor", "rules", "memory.mdc"))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/write-agent-configs.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/utils/write-agent-configs.ts`:

Function `writeAgentConfigs(projectDir: string, agents: AgentId[], config: { vaultName: string, hybridSearchAvailable: boolean }): void`:
1. Always write `AGENTS.md` (using `generateAgentsMd` from Task 3)
2. For each agent in the array, write the agent-specific config file:
   - `claude-code`: Write `CLAUDE.md` (using `generateClaudeMd`)
   - `cursor`: Create `.cursor/rules/` dir, write `memory.mdc` (using `generateCursorRule`)
   - `antigravity`: Write `GEMINI.md` (using `generateGeminiMd`)
   - `opencode`: Merge into `opencode.json` or create one (using `generateOpenCodeConfig`)
   - `forgecode`: Print instructions for adding to `forge.yaml` (using `generateForgeConfig`)
3. Create parent directories as needed (`mkdirSync recursive`)

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/write-agent-configs.test.ts
```

Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: agent config writer utility"
```

---

## Task 9: Interactive Init Wizard

**Files:**
- Modify: `src/index.ts` (wire up init command)
- Create: `src/commands/init.ts` (the init command logic)
- Test: `src/__tests__/init.test.ts` (integration test)

**Step 1: Write the failing test**

Create `src/__tests__/init.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getDefaultVaultPath, resolveVaultName } from "../commands/init.js";

describe("init helpers", () => {
  it("returns default vault path in home directory", () => {
    const defaultPath = getDefaultVaultPath();
    expect(defaultPath).toContain("ObsidianMemory");
  });

  it("resolves vault name from path", () => {
    expect(resolveVaultName("/Users/test/ObsidianMemory")).toBe("ObsidianMemory");
    expect(resolveVaultName("/Users/test/My Vault")).toBe("My Vault");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/init.test.ts
```

Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/commands/init.ts`:

The init command flow:
1. Print welcome banner
2. Check Obsidian CLI availability (`checkObsidianCli()`) -- warn if not available
3. Check hybrid search availability (`checkHybridSearch()`)
4. Prompt for vault location (default: `~/ObsidianMemory/`)
5. Prompt for which agents to configure (show checkboxes, auto-select detected ones)
6. Create vault structure (`createVault()`)
7. Write agent configs to the current project directory (`writeAgentConfigs()`)
8. Print summary of what was created
9. Print next steps (open vault in Obsidian, start an agent session)

Use `inquirer` for interactive prompts, `chalk` for colored output, `ora` for spinners.

Export helper functions `getDefaultVaultPath()` and `resolveVaultName()` for testing.

Then update `src/index.ts` to import and wire up the init action.

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/init.test.ts
```

Expected: All 2 tests PASS.

**Step 5: Build and manual smoke test**

```bash
npm run build
node dist/index.js init --help
```

Expected: Shows init command help.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: interactive init wizard with agent detection"
```

---

## Task 10: End-to-End Integration Test

**Files:**
- Create: `src/__tests__/e2e.test.ts`

**Step 1: Write the integration test**

Create `src/__tests__/e2e.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault } from "../utils/create-vault.js";
import { writeAgentConfigs } from "../utils/write-agent-configs.js";
import type { AgentId } from "../templates/agent-configs.js";

describe("e2e: full init flow", () => {
  let vaultDir: string;
  let projectDir: string;

  beforeEach(() => {
    const base = join(tmpdir(), `obsidian-memory-e2e-${Date.now()}`);
    vaultDir = join(base, "ObsidianMemory");
    projectDir = join(base, "my-project");
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates complete vault structure and all agent configs", () => {
    // Step 1: Create vault
    createVault(vaultDir);

    // Verify vault structure
    expect(existsSync(join(vaultDir, "Memory", "Index.md"))).toBe(true);
    expect(existsSync(join(vaultDir, "Memory", "Projects"))).toBe(true);
    expect(existsSync(join(vaultDir, "Memory", "Sessions"))).toBe(true);
    expect(existsSync(join(vaultDir, "Memory", "Decisions"))).toBe(true);

    // Step 2: Write agent configs for all five agents
    const agents: AgentId[] = ["claude-code", "cursor", "antigravity", "opencode", "forgecode"];
    writeAgentConfigs(projectDir, agents, {
      vaultName: "ObsidianMemory",
      hybridSearchAvailable: false,
    });

    // Verify AGENTS.md exists and references vault
    const agentsMd = readFileSync(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("ObsidianMemory");
    expect(agentsMd).toContain("obsidian read");
    expect(agentsMd).toContain("Session Start");
    expect(agentsMd).toContain("Session End");

    // Verify per-agent configs
    expect(existsSync(join(projectDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".cursor", "rules", "memory.mdc"))).toBe(true);
    expect(existsSync(join(projectDir, "GEMINI.md"))).toBe(true);
  });

  it("AGENTS.md includes keyword search fallback when hybrid search unavailable", () => {
    createVault(vaultDir);
    writeAgentConfigs(projectDir, ["claude-code"], {
      vaultName: "ObsidianMemory",
      hybridSearchAvailable: false,
    });

    const agentsMd = readFileSync(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("obsidian search");
    expect(agentsMd).not.toContain("obsidian-hybrid-search");
  });

  it("AGENTS.md includes hybrid search when available", () => {
    createVault(vaultDir);
    writeAgentConfigs(projectDir, ["claude-code"], {
      vaultName: "ObsidianMemory",
      hybridSearchAvailable: true,
    });

    const agentsMd = readFileSync(join(projectDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("obsidian-hybrid-search");
  });

  it("vault template notes have valid frontmatter with today's date", () => {
    createVault(vaultDir);
    const index = readFileSync(join(vaultDir, "Memory", "Index.md"), "utf-8");
    const today = new Date().toISOString().split("T")[0];
    expect(index).toContain(`created: ${today}`);
  });
});
```

**Step 2: Run the integration test**

```bash
npm run test -- src/__tests__/e2e.test.ts
```

Expected: All 4 tests PASS.

**Step 3: Run full test suite**

```bash
npm run test
```

Expected: All tests across all files PASS.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: end-to-end integration tests"
```

---

## Task 11: Build, Lint, Final Verification

**Files:**
- Modify: `package.json` (verify scripts work)

**Step 1: Type-check**

```bash
npm run lint
```

Expected: No TypeScript errors.

**Step 2: Full build**

```bash
npm run build
```

Expected: Clean build, `dist/` directory created with `index.js` and type declarations.

**Step 3: Test the CLI binary**

```bash
node dist/index.js --help
node dist/index.js --version
```

Expected: Help text and version `0.1.0`.

**Step 4: Run full test suite one more time**

```bash
npm run test
```

Expected: All tests PASS.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify build, lint, and all tests pass"
```

---

## Summary

| Task | What it builds | Key files |
|------|---------------|-----------|
| 1 | Project scaffolding | package.json, tsconfig, src/index.ts |
| 2 | Vault structure templates | src/templates/vault-structure.ts |
| 3 | AGENTS.md memory protocol | src/templates/agents-md.ts |
| 4 | Per-agent config generators | src/templates/agent-configs.ts |
| 5 | Agent detection utility | src/utils/detect-agents.ts |
| 6 | Obsidian CLI availability check | src/utils/check-obsidian.ts |
| 7 | Vault creator | src/utils/create-vault.ts |
| 8 | Agent config writer | src/utils/write-agent-configs.ts |
| 9 | Interactive init wizard | src/commands/init.ts |
| 10 | E2E integration tests | src/__tests__/e2e.test.ts |
| 11 | Build verification | Final lint + build + test |

**Dependencies between tasks:**
- Task 1 must be first (scaffolding)
- Tasks 2-6 are independent of each other (parallelizable)
- Task 7 depends on Task 2 (uses vault-structure templates)
- Task 8 depends on Tasks 3 + 4 (uses agents-md + agent-configs generators)
- Task 9 depends on Tasks 5 + 6 + 7 + 8 (composes all utilities)
- Task 10 depends on Tasks 7 + 8 (integration test)
- Task 11 depends on everything (final verification)
