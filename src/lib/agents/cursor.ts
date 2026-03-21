export function generateCursorConfig(): string {
  return `---
description: Obsidian Memory system integration — persistent cross-agent memory
alwaysApply: true
---

# Memory System

This project uses obsidian-memory for persistent, cross-agent memory stored in an Obsidian vault.

## Session Start
Run \`obsidian-memory load-context\` to load project context from the memory vault.

## Session End
Run \`obsidian-memory save-session --agent cursor --summary "<summary>"\` to save a session summary.

## Search Memory
Run \`obsidian-memory search "<query>"\` to search past sessions, decisions, and context.

## Full Protocol
See AGENTS.md for the complete memory protocol.
`;
}

export function getCursorConfigPath(): string {
  return ".cursor/rules/memory.mdc";
}
