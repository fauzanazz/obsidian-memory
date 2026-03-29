export function generateAgentsMd(project: string, _vault?: string): string {
  return `# Memory System — obsidian-memory

This project uses **obsidian-memory** for persistent, cross-agent memory.
All session context, decisions, conventions, and progress are stored locally
and accessible to any AI coding agent that reads this file.

**Project:** \`${project}\`

---

## Session Start Protocol

At the beginning of every session, run:

\`\`\`bash
obsidian-memory load-context
\`\`\`

This outputs a compact project summary, current state, active blockers, pending next steps,
and one-line indexes of features, decisions, and recent sessions.

**Options for different needs:**
- \`--minimal\` — just the essentials (~500 tokens, use when context is tight)
- \`--focus "auth"\` — full detail for auth-related notes, compact for the rest
- \`--full\` — everything (full session notes, full docs)
- \`--task "description"\` — task-aware retrieval: finds sessions and events relevant to your current task

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

This uses hybrid search (keyword + semantic when GEMINI_API_KEY is set). Use it when:
- You need to recall why a decision was made
- You want to check if something was already attempted
- You need context from a previous session by a different agent

### Querying Events

To search the temporal event index:

\`\`\`bash
obsidian-memory query "authentication" --since 2026-03-01
obsidian-memory timeline --last 7d
\`\`\`

### Retrieving a Session

To get the full content of a specific session:

\`\`\`bash
obsidian-memory get <session-id>
\`\`\`

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

When you save a session, it is stored with a temporal event record. The next agent
(regardless of which tool it is) will see your session summary when it runs
\`obsidian-memory load-context\`.

**To ensure smooth handoffs:**
1. Always save a session summary before ending
2. Include any blockers or open questions
3. List concrete next steps
4. Mention files that were modified

---

## Memory Consolidation

If the project has many old session notes, suggest running:

\`\`\`bash
# LLM-powered distillation (recommended)
obsidian-memory consolidate --distill

# Simple archive mode (no LLM required)
obsidian-memory consolidate --auto
\`\`\`

---

## Troubleshooting

### "No .obsidian-memory config found"
Run \`obsidian-memory init\` to set up the project.

### "Session not found"
The session ID may be incorrect. Use \`obsidian-memory timeline\` to find recent sessions.

---

## Command Reference

| Command | Description |
|---------|-------------|
| \`obsidian-memory status\` | Check system health |
| \`obsidian-memory load-context\` | Load project context |
| \`obsidian-memory save-session\` | Save a session summary |
| \`obsidian-memory save-feature\` | Save a feature note |
| \`obsidian-memory save-decision\` | Create an Architecture Decision Record |
| \`obsidian-memory search <query>\` | Hybrid search across memory |
| \`obsidian-memory query <text>\` | Search events and sessions |
| \`obsidian-memory timeline\` | Show project event timeline |
| \`obsidian-memory get <session-id>\` | Get full session content |
| \`obsidian-memory consolidate\` | Archive old sessions |
| \`obsidian-memory document\` | Scan project and generate docs |
| \`obsidian-memory maintain --enrich\` | Extract features, decisions, events from sessions |
| \`obsidian-memory sync\` | Export to Obsidian vault (optional) |
| \`obsidian-memory migrate\` | Import from Obsidian vault |
| \`obsidian-memory init\` | Set up a new project |
`;
}
