---
name: obsidian-memory
description: "How to use the obsidian-memory system for persistent, cross-agent memory during coding sessions. Use this skill whenever working in a project that has an AGENTS.md referencing obsidian-memory, a .obsidian-memory.json config file, or when the user mentions obsidian memory, session memory, loading context from previous sessions, saving session summaries, cross-agent handoffs, or searching past decisions. Also trigger when you see commands like `obsidian-memory load-context`, `obsidian-memory save-session`, or `obsidian-memory search`. If the project has a .obsidian-memory.json file, always use this skill at the start and end of sessions."
---

# obsidian-memory — Persistent Cross-Agent Memory

obsidian-memory gives AI coding agents persistent memory across sessions and tools. Decisions, conventions, progress, and session context are stored in an Obsidian vault and shared between Claude Code, Cursor, Antigravity, OpenCode, and ForgeCode.

The key insight: when you save a good session summary, the *next* agent (which may be a completely different tool) picks up exactly where you left off. Your job is to be a good teammate — load what came before, do your work, and leave a clear trail.

---

## Session Lifecycle

Every session follows three phases: **Load → Work → Save**. This is the most important thing to internalize.

### 1. Session Start — Load Context

At the very beginning of a session, before doing any work, run:

```bash
obsidian-memory load-context
```

By default, this outputs a compact view (**Tier 1 + Tier 2**):
- **Project summary** — first paragraph from context.md
- **Current state + blockers** — compact progress snapshot
- **Continuity** — last session's summary and pending next steps
- **Feature/decision/module indexes** — one line each
- **Recent sessions** — one-line summaries (not full content)
- **Conventions** — compact (truncated to 500 chars each)

Read this output carefully. It contains decisions and context that should inform your work.

**Tier options:**
- `--minimal` — **Tier 1 only**: project summary, current state, blockers, last session's next steps (~500 tokens). Use when context window is tight.
- `--focus <keyword>` — **Tier 1 + keyword-filtered content**: loads full content for notes matching the keyword, compact indexes for everything else. Use when working on a specific area (e.g., `--focus "auth"`).
- `--full` — **Everything**: full project context, full progress, full session notes, full module docs. This is the original behavior before tiered loading was added.
- *(no flag)* — **Default (Tier 1 + Tier 2)**: compact but comprehensive. Good for most sessions.

**Filter options (work with all tiers):**
- `--no-conventions` — skip conventions section
- `--no-decisions` — skip decisions section
- `--sessions <n>` — change number of recent sessions (default: 3)

### 2. During Work — Search When Needed

If you need to recall past context, decisions, or work:

```bash
obsidian-memory search "your query here"
```

Use search when:
- You need to recall **why** a decision was made
- You want to check if something was already attempted
- You need context from a previous session by a different agent
- The user asks about past work or decisions

**Options:**
- `--path <path>` — limit search to a vault path (e.g., `Memory/Projects/`)
- `--limit <n>` — max results

The search uses semantic search (via obsidian-hybrid-search plugin) when available, falling back to keyword search.

### 3. Session End — Save Summary

Before ending a session, or when context is about to be compacted, save what happened:

```bash
obsidian-memory save-session \
  --agent claude-code \
  --summary "Brief description of what was accomplished" \
  --decisions "Decision 1" "Decision 2" \
  --files "src/auth.ts" "src/middleware.ts" \
  --blockers "Open question about rate limiting" \
  --next "Add refresh token rotation" "Write tests for auth flow"
```

**Required flags:**
- `--agent <name>` — which agent you are: `claude-code`, `cursor`, `antigravity`, `opencode`, or `forgecode`
- `--summary <text>` — concise description of what was accomplished

**Optional flags:**
- `--decisions <items...>` — significant decisions made (architectural, design, library choices)
- `--files <items...>` — files that were modified
- `--blockers <items...>` — open questions or blockers for the next session
- `--next <items...>` — concrete next steps

**Writing good summaries:**
- Be specific: "Implemented JWT auth with httpOnly cookies and refresh token rotation" not "Worked on auth"
- Include the **why** behind decisions, not just what was decided
- Blockers and next steps are the most valuable parts for handoffs — they tell the next agent exactly what to do
- Mention files so the next agent knows where to look

---

## Setup (for new projects)

If the project doesn't have obsidian-memory yet and the user wants to set it up:

```bash
obsidian-memory init --vault <vault-name> --project <project-name>
```

This creates:
- `.obsidian-memory.json` — project config
- `AGENTS.md` — memory protocol (read by all agents)
- Agent-specific config files for detected agents (CLAUDE.md, .cursor/rules/memory.mdc, etc.)

To also create the vault folder structure on disk:
```bash
obsidian-memory init --vault MyVault --project my-app --vault-path ~/MyVault
```

To configure specific agents:
```bash
obsidian-memory init --vault MyVault --project my-app --agents claude-code cursor
```

Without `--vault` and `--project`, init runs interactively (which requires user input, so suggest the user run it themselves with `!`).

---

## Health Check

```bash
obsidian-memory status
```

Reports: config found, Obsidian running, CLI available, vault health, search capability. Run this first if anything seems wrong.

---

## Memory Consolidation

When the vault accumulates many session notes (30+ days old), suggest:

```bash
obsidian-memory consolidate --auto
```

This merges old sessions into monthly journal entries. The `--days <n>` flag controls the age threshold (default: 30). Without `--auto`, it shows what would be consolidated without acting.

---

## Vault Structure

Understanding where things live helps when debugging or browsing in Obsidian:

```
Memory/
├── Index.md                         # Master index
├── Projects/{project-name}/
│   ├── context.md                   # Tech stack, architecture
│   ├── decisions.md                 # Decision log
│   └── progress.md                  # Current state, session links
├── Conventions/                     # Shared coding standards
├── Sessions/
│   └── YYYY-MM-DD-agent-hash.md    # Individual session notes
├── Journal/
│   └── YYYY-MM.md                   # Monthly consolidated journals
└── Templates/                       # Note templates
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Obsidian is not running" | Ask the user to start the Obsidian desktop app |
| "No .obsidian-memory.json found" | Run `obsidian-memory init` in the project |
| "vault not found" | The vault needs to be opened in Obsidian first |
| Search returns nothing | Check that `Memory/` folder exists in the vault with content |
| "CLI not available" | User needs Obsidian v1.12.4+ with CLI enabled (Settings → General → CLI → Register) |

---

## Requirements

- **Bun** runtime (obsidian-memory is built on Bun)
- **Obsidian** v1.12.4+ desktop app running, with CLI enabled
- Optional: **obsidian-hybrid-search** plugin for semantic search
