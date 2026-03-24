export function generateAgentsMd(project: string, vault: string): string {
  return `# Memory System — obsidian-memory

This project uses **obsidian-memory** for persistent, cross-agent memory stored in an Obsidian vault.
All session context, decisions, conventions, and progress are stored in the vault and accessible
to any AI coding agent that reads this file.

**Vault:** \`${vault}\`
**Project:** \`${project}\`

---

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

Read the output carefully before starting work — it contains decisions and context from prior sessions.

---

## During Work

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

### Searching Memory

If you need to recall past context, decisions, or work:

\`\`\`bash
obsidian-memory search "your query here"
\`\`\`

This searches the entire memory vault. Use it when:
- You need to recall why a decision was made
- You want to check if something was already attempted
- You need context from a previous session by a different agent

---

## Session End Protocol

Before ending a session (or when context is about to be compacted), save a session summary:

\`\`\`bash
obsidian-memory save-session \\
  --agent <your-agent-name> \\
  --summary "Brief description of what was accomplished" \\
  --decisions "Decision 1" "Decision 2" \\
  --files "file1.ts" "file2.ts" \\
  --blockers "Any open questions" \\
  --next "Next step 1" "Next step 2"
\`\`\`

**Agent names:** \`claude-code\`, \`cursor\`, \`antigravity\`, \`opencode\`, \`forgecode\`

The summary should be concise but complete enough for a different agent to continue the work.

---

## Cross-Agent Handoff

When you save a session, the note is stored in the vault with wikilinks to the project context
and decision log. The next agent (regardless of which tool it is) will see your session summary
when it runs \`obsidian-memory load-context\`.

**To ensure smooth handoffs:**
1. Always save a session summary before ending
2. Include any blockers or open questions
3. List concrete next steps
4. Mention files that were modified

---

## Memory Consolidation

If the vault has many old session notes, suggest running:

\`\`\`bash
# LLM-powered distillation (recommended — produces rich journals + updates canonical docs)
obsidian-memory consolidate --distill

# Simple summary-only mode (no LLM required)
obsidian-memory consolidate --auto
\`\`\`

Distillation reads old sessions, synthesizes themes and patterns, updates project context
and progress, creates missing feature/decision notes, and archives the original sessions.
Requires a \`GEMINI_API_KEY\` environment variable.

---

## Documentation Protocol

This project maintains structured documentation in the memory vault to prevent feature duplication
and enable surgical debugging. Generate docs with \`obsidian-memory document\`, then maintain them
during sessions.

### Before Creating New Code

Search the documentation before implementing anything new:

\`\`\`bash
obsidian-memory search "feature name or concept"
\`\`\`

If the feature already exists, work with the existing implementation instead of creating a duplicate.
The Features doc lists what's been built; the Modules doc maps directories to their purpose.

### Before Debugging

Read the module documentation to know exactly where to look:

\`\`\`bash
obsidian-memory search "module or area related to the bug"
\`\`\`

The Modules doc maps directories to their purpose and entry points — use it to go straight
to the right file instead of exploring blindly.

### After Implementing

Update the relevant documentation:
- **Save new features**: \`obsidian-memory save-feature --slug my-feature --title "My Feature" --summary "What it does"\`
- Update module descriptions if you changed a module's purpose
- Add patterns or gotchas to Conventions
- Update Architecture if you changed the system structure

---

## Automatic Enrichment

After saving a session, you can run enrichment to automatically create feature notes,
ADR notes, and cross-links from the session content:

\`\`\`bash
obsidian-memory maintain --enrich
\`\`\`

This uses an LLM to analyze the session and extract structured artifacts.
Requires a \`GEMINI_API_KEY\` environment variable (or the key configured in \`.obsidian-memory.json\`).

---

## Troubleshooting

### "Obsidian is not running"
The memory system requires the Obsidian desktop app to be running. Ask the user to start Obsidian.

### "No .obsidian-memory.json found"
Run \`obsidian-memory init\` to set up the project.

### "vault not found"
The vault \`${vault}\` may not exist in Obsidian. Ask the user to open it in Obsidian.

---

## Command Reference

| Command | Description |
|---------|-------------|
| \`obsidian-memory status\` | Check system health |
| \`obsidian-memory load-context\` | Load project context |
| \`obsidian-memory save-session\` | Save a session summary |
| \`obsidian-memory save-feature\` | Save a feature note |
| \`obsidian-memory search <query>\` | Search memory vault |
| \`obsidian-memory consolidate\` | Merge old sessions |
| \`obsidian-memory save-decision\` | Create an Architecture Decision Record |
| \`obsidian-memory document\` | Scan project and generate docs |
| \`obsidian-memory maintain --enrich\` | Auto-extract features, decisions, and cross-links from sessions |
| \`obsidian-memory init\` | Set up a new project |
`;
}
