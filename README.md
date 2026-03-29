# obsidian-memory

Universal memory layer for AI coding agents — offline-first, powered by SQLite.

Start work in Claude Code, switch to Cursor, continue in Antigravity — your AI agents share persistent memory through a local database. Decisions, conventions, progress, and session context survive across agents and sessions. Optionally sync to an [Obsidian](https://obsidian.md) vault for browsing.

## Requirements

- [Bun](https://bun.sh) runtime (>=1.0.0)
- Optional: [Obsidian](https://obsidian.md) for browsing synced notes
- Optional: LLM API key (Gemini/Anthropic/OpenAI) for semantic search and session enrichment

## Installation

```bash
bunx obsidian-memory init
```

Or install globally:

```bash
bun add -g obsidian-memory
```

## Quick Start

```bash
# In your project directory:
bunx obsidian-memory init --project my-app

# Check everything is working:
obsidian-memory status

# Load prior context at session start:
obsidian-memory load-context

# Save a session when done:
obsidian-memory save-session --agent claude-code --summary "Implemented auth flow"
```

This creates:
- `.obsidian-memory/` — local database directory (SQLite + binary embeddings)
- `AGENTS.md` — memory protocol (read by all agents)
- Agent-specific config files for detected agents

## Supported Agents

| Agent | Config Generated | How It Integrates |
|-------|-----------------|-------------------|
| **Claude Code** | `CLAUDE.md` with `@AGENTS.md` import | Reads AGENTS.md via @import |
| **Cursor** | `.cursor/rules/memory.mdc` | Always-applied rule |
| **Antigravity** | `GEMINI.md` with `@AGENTS.md` import | Reads AGENTS.md via @import |
| **OpenCode** | `opencode.json` instructions field | Loads AGENTS.md as instruction |
| **ForgeCode** | `forge.yaml` custom_rules | References AGENTS.md |

Agents are auto-detected during `init`. Override with `--agents`:

```bash
obsidian-memory init --project my-app --agents claude-code cursor
```

## Commands

### `init`

Set up memory for a project. Creates the `.obsidian-memory/` directory with a SQLite database and config.

```bash
obsidian-memory init [--project <name>] [--vault <name>] [--vault-path <path>] [--agents <agents...>]
```

- `--project` — Project identifier (defaults to directory name)
- `--vault` — Obsidian vault name (optional, for sync)
- `--vault-path` — Filesystem path to Obsidian vault (optional, for sync)
- `--agents` — Which agents to configure (auto-detected if omitted)

### `status`

Check system health — database stats, embedding count, config version.

```bash
obsidian-memory status
```

### `load-context`

Load project context from the database. Outputs consolidated markdown with project info, decisions, conventions, and recent sessions.

```bash
obsidian-memory load-context [--minimal] [--full] [--focus <keyword>] [--task <description>]
                             [--no-conventions] [--no-decisions] [--sessions <n>]
```

- `--minimal` — Tier 1 only: project summary, current state, blockers (~500 tokens)
- `--focus <keyword>` — Full content for matching notes, compact for the rest
- `--task <description>` — Task-aware retrieval guided by task description
- `--full` — Load everything

### `save-session`

Save a session summary to the database.

```bash
obsidian-memory save-session \
  --agent claude-code \
  --summary "Implemented auth flow" \
  --decisions "Use JWT" "Store in httpOnly cookies" \
  --files "src/auth.ts" "src/middleware.ts" \
  --blockers "Refresh token rotation" \
  --next "Add refresh token rotation"
```

### `save-decision`

Create an Architecture Decision Record (ADR) with auto-incrementing numbering.

```bash
obsidian-memory save-decision \
  --title "JWT over Session Cookies" \
  --context "Need stateless auth for microservices" \
  --decision "Use JWT with httpOnly cookies" \
  --alternatives "Session cookies: simpler but stateful" \
  --consequences "Must handle token refresh"
```

### `save-feature`

Track a feature with status and metadata.

```bash
obsidian-memory save-feature \
  --slug auth-jwt \
  --title "JWT Authentication" \
  --status in-progress \
  --summary "Token-based auth with refresh rotation" \
  --key-files "src/auth.ts:JWT signing" "src/middleware.ts:Token validation"
```

### `search <query>`

Hybrid search across memory — combines FTS5 keyword search with vector similarity (RRF k=60).

```bash
obsidian-memory search "authentication decisions"
obsidian-memory search "auth" --limit 5
```

### `query <text>`

Search events and sessions by keyword with optional date filtering.

```bash
obsidian-memory query "auth refactor" --since 2025-01-01 --until 2025-03-01
```

### `get <session-id>`

Retrieve full session content by ID.

```bash
obsidian-memory get 2025-03-15-claude-code-a1b2c3
```

### `timeline`

Show project event timeline.

```bash
obsidian-memory timeline --last 7d
obsidian-memory timeline --since 2025-01-01 --until 2025-03-01
```

### `consolidate`

Merge old sessions into archived entries. Optionally use LLM distillation.

```bash
obsidian-memory consolidate --days 30 --auto
obsidian-memory consolidate --distill   # LLM-powered enrichment
```

### `maintain`

Run maintenance tasks on the memory database.

```bash
obsidian-memory maintain --enrich              # Enrich unenriched sessions
obsidian-memory maintain --session <id>        # Enrich a specific session
```

### `document`

Scan the project and generate documentation in the memory directory.

```bash
obsidian-memory document [--force]
```

### `sync`

Export SQLite memory to an Obsidian vault as markdown notes.

```bash
obsidian-memory sync [--vault-path <path>]
```

### `migrate`

Import an existing Obsidian vault (v1) into the SQLite database.

```bash
obsidian-memory migrate --from-vault ~/ObsidianMemory
```

## Storage

All data lives in `.obsidian-memory/` at the project root:

```
.obsidian-memory/
├── config.json        # Project config (project name, agents, vault info)
├── memory.db          # SQLite database (sessions, events, decisions, features)
├── embeddings.bin     # Binary embedding index (optional, for semantic search)
└── docs/              # Generated documentation
```

The SQLite database uses FTS5 for full-text search with stemming. Binary embeddings use a compact format with Float32Array vectors for brute-force cosine similarity — fast enough for <10K documents.

## How It Works

1. **Agent reads `AGENTS.md`** → learns the memory protocol
2. **Session start** → agent runs `obsidian-memory load-context` to load prior context
3. **During work** → agent saves decisions, features, and progress as needed
4. **Session end** → agent runs `obsidian-memory save-session` to persist a summary
5. **Next session (any agent)** → picks up exactly where the previous one left off
6. **Optionally** → run `obsidian-memory sync` to export to Obsidian for graph-view browsing

No MCP server required. Agents use shell commands directly. No Obsidian runtime needed for core operations.

## Migrating from v1

If you have an existing Obsidian vault from v1:

```bash
obsidian-memory migrate --from-vault ~/path/to/vault
```

This imports sessions, events, decisions, and embeddings into the SQLite database. Your vault is not modified.

## Claude Code Skill

A Claude Code [skill](https://docs.anthropic.com/en/docs/claude-code/skills) is included for agents that want the obsidian-memory protocol available without reading `AGENTS.md` each session.

**Install:**

```bash
cp -r skills/obsidian-memory ~/.claude/skills/obsidian-memory
```

Once installed, Claude Code automatically triggers the skill when it detects `.obsidian-memory/` or when you mention session memory, loading context, saving sessions, or searching past decisions.

## Troubleshooting

**"No .obsidian-memory/ found"** — Run `obsidian-memory init` in your project directory.

**"Database not found"** — The `.obsidian-memory/memory.db` file is missing. Re-run `obsidian-memory init`.

**Search returns no results** — Ensure you have saved at least one session. For semantic search, an LLM API key must be configured.

**Sync fails** — Check that the vault path in `.obsidian-memory/config.json` is correct and the directory exists.

## License

MIT
