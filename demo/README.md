# obsidian-memory Demo

This demo shows exactly what obsidian-memory does to your project. Browse the folders to see the before and after.

## Structure

```
demo/
├── before/                        # A sample project BEFORE obsidian-memory
│   ├── src/
│   │   ├── index.ts
│   │   └── db.ts
│   ├── package.json
│   └── tsconfig.json
│
├── after/                         # The SAME project AFTER `obsidian-memory init`
│   ├── src/
│   │   ├── index.ts               (unchanged)
│   │   └── db.ts                  (unchanged)
│   ├── package.json               (unchanged)
│   ├── tsconfig.json              (unchanged)
│   ├── .obsidian-memory.json      <-- NEW: config
│   ├── AGENTS.md                  <-- NEW: memory protocol
│   ├── CLAUDE.md                  <-- NEW: Claude Code integration
│   ├── GEMINI.md                  <-- NEW: Antigravity integration
│   └── .cursor/rules/memory.mdc   <-- NEW: Cursor integration
│
└── vault/                         # Obsidian vault with example content
    └── Memory/
        ├── Index.md
        ├── Projects/todo-app/
        │   ├── context.md
        │   ├── decisions.md
        │   └── progress.md
        ├── Sessions/
        │   ├── 2026-03-21-claude-code-a1b2c3.md
        │   └── 2026-03-22-cursor-e4f5a1.md
        ├── Conventions/
        ├── Journal/
        │   └── 2026-02.md
        └── Templates/
            ├── session.md
            ├── project.md
            └── decision.md
```

## Quick Start

To try it yourself on a real project:

```bash
# 1. Install
bun add -g obsidian-memory

# 2. Go to your project
cd ~/your-project

# 3. Initialize (auto-detects your agents)
obsidian-memory init --vault MyVault --project your-project

# 4. Check health
obsidian-memory status
```

## What Gets Created

### In your project directory

| File | Purpose |
|------|---------|
| `.obsidian-memory.json` | Config: vault name, project name, active agents |
| `AGENTS.md` | Memory protocol that all AI agents read |
| `CLAUDE.md` | Tells Claude Code to follow AGENTS.md |
| `.cursor/rules/memory.mdc` | Tells Cursor to follow the memory protocol |
| `GEMINI.md` | Tells Antigravity/Gemini to follow AGENTS.md |

### In your Obsidian vault

| Path | Purpose |
|------|---------|
| `Memory/Index.md` | Master index with links to everything |
| `Memory/Projects/<name>/context.md` | Tech stack, architecture, conventions |
| `Memory/Projects/<name>/decisions.md` | Decision log (ADR-style) |
| `Memory/Projects/<name>/progress.md` | Current state, todos, blockers |
| `Memory/Sessions/` | Session notes from each AI agent |
| `Memory/Journal/` | Monthly consolidated journals |
| `Memory/Templates/` | Note templates for Obsidian |

## How It Works

```
  Claude Code          Cursor            Antigravity
      |                  |                    |
      v                  v                    v
   CLAUDE.md    .cursor/rules/memory.mdc   GEMINI.md
      |                  |                    |
      +--------+---------+--------------------+
               |
               v
           AGENTS.md  (shared memory protocol)
               |
               v
    obsidian-memory CLI commands
               |
               v
        Obsidian Vault
    (sessions, decisions, context)
```

1. Agent starts a session -> runs `obsidian-memory load-context`
2. Agent works -> uses `obsidian-memory search` as needed
3. Agent finishes -> runs `obsidian-memory save-session`
4. Next agent (any tool) -> picks up where the last one left off
