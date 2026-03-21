# obsidian-memory

Universal memory layer for AI coding agents, powered by [Obsidian](https://obsidian.md).

Start work in Claude Code, switch to Cursor, continue in Antigravity — your AI agents share persistent memory through an Obsidian vault. Decisions, conventions, progress, and session context survive across agents and sessions.

## Requirements

- [Bun](https://bun.sh) runtime
- [Obsidian](https://obsidian.md) v1.12.4+ with CLI enabled (Settings → General → CLI → Register)
- Optional: [obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) for semantic search

## Quick Start

```bash
# In your project directory:
bunx obsidian-memory init --vault ObsidianMemory --project my-app

# Check everything is working:
obsidian-memory status
```

This creates:
- `.obsidian-memory.json` — project config
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
obsidian-memory init --vault MyVault --project my-app --agents claude-code cursor
```

## Commands

### `obsidian-memory init`

Set up memory for a project.

```bash
obsidian-memory init --vault <name> --project <name> [--vault-path <path>] [--agents <agents...>]
```

- `--vault` — Obsidian vault name
- `--project` — Project identifier
- `--vault-path` — Create the vault folder structure at this path
- `--agents` — Which agents to configure (auto-detected if omitted)

### `obsidian-memory status`

Check system health.

```bash
obsidian-memory status
```

Reports: config found, Obsidian running, CLI available, search capability.

### `obsidian-memory load-context`

Load project context from the vault. Outputs consolidated markdown with project info, decisions, conventions, and recent sessions.

```bash
obsidian-memory load-context [--no-conventions] [--no-decisions] [--sessions <n>]
```

### `obsidian-memory save-session`

Save a session summary to the vault.

```bash
obsidian-memory save-session \
  --agent claude-code \
  --summary "Implemented auth flow" \
  --decisions "Use JWT" "Store in httpOnly cookies" \
  --files "src/auth.ts" "src/middleware.ts" \
  --next "Add refresh token rotation"
```

### `obsidian-memory search <query>`

Search the memory vault.

```bash
obsidian-memory search "authentication decisions"
obsidian-memory search "auth" --path Memory/Projects/
```

Uses `obsidian-hybrid-search` for semantic search when available, falls back to Obsidian CLI keyword search.

### `obsidian-memory consolidate`

Merge old session notes into monthly journal entries.

```bash
obsidian-memory consolidate --days 30 --auto
```

## Vault Structure

The memory vault uses this structure:

```
Memory/
├── Index.md                    # Auto-maintained master index
├── Projects/
│   └── {project-name}/
│       ├── context.md          # Tech stack, architecture, conventions
│       ├── decisions.md        # Decision log
│       └── progress.md         # Current state, todos, blockers
├── Conventions/                # Shared coding standards
├── Sessions/
│   └── YYYY-MM-DD-agent-hash.md  # Session summaries
├── Journal/
│   └── YYYY-MM.md             # Monthly consolidated journal
└── Templates/
    ├── session.md
    ├── project.md
    └── decision.md
```

All notes use Obsidian-native markdown with YAML frontmatter, wikilinks, and tags — fully browsable in Obsidian's graph view.

## How It Works

1. **Agent reads `AGENTS.md`** → learns the memory protocol
2. **Session start** → agent runs `obsidian-memory load-context` to load prior context
3. **During work** → agent saves decisions and progress as needed
4. **Session end** → agent runs `obsidian-memory save-session` to persist a summary
5. **Next session (any agent)** → picks up exactly where the previous one left off

No MCP server, no custom embedding engine. Agents use shell commands directly.

## Troubleshooting

**"Obsidian is not running"** — Start the Obsidian desktop app. The CLI requires it.

**"No .obsidian-memory.json found"** — Run `obsidian-memory init` in your project directory.

**"vault not found"** — Open the vault in Obsidian first, or check the vault name in `.obsidian-memory.json`.

**Search returns no results** — Ensure the `Memory/` folder exists in the vault and has content.

## License

MIT
