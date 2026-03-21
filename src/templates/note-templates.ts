// Note templates are defined inline in vault.ts as part of getVaultStructure().
// This module provides helper functions for generating individual notes at runtime.

export function sessionNote(options: {
  agent: string;
  project: string;
  date: string;
  summary: string;
  decisions?: string[];
  files?: string[];
  blockers?: string[];
  nextSteps?: string[];
}): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("type: session");
  lines.push(`agent: ${options.agent}`);
  lines.push(`project: ${options.project}`);
  lines.push(`created: ${options.date}`);
  lines.push(`updated: ${options.date}`);
  lines.push("tags:");
  lines.push("  - session");
  lines.push(`  - agent/${options.agent}`);
  lines.push(`  - project/${options.project}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Session — ${options.date} — ${options.agent}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(options.summary);
  lines.push("");

  if (options.decisions?.length) {
    lines.push("## Decisions Made");
    for (const d of options.decisions) lines.push(`- ${d}`);
    lines.push("");
  }

  if (options.files?.length) {
    lines.push("## Files Modified");
    for (const f of options.files) lines.push(`- \`${f}\``);
    lines.push("");
  }

  if (options.blockers?.length) {
    lines.push("## Blockers");
    for (const b of options.blockers) lines.push(`- ${b}`);
    lines.push("");
  }

  if (options.nextSteps?.length) {
    lines.push("## Next Steps");
    for (const n of options.nextSteps) lines.push(`- ${n}`);
    lines.push("");
  }

  lines.push("## Links");
  lines.push(`- Project: [[${options.project}/context|${options.project}]]`);
  lines.push(`- Decisions: [[${options.project}/decisions|${options.project} decisions]]`);
  lines.push("");

  return lines.join("\n");
}

export function decisionNote(options: {
  project: string;
  date: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
}): string {
  return `---
type: decision
project: ${options.project}
created: ${options.date}
status: accepted
tags:
  - decision
  - project/${options.project}
---

# Decision: ${options.title}

## Context
${options.context}

## Decision
${options.decision}

## Consequences
${options.consequences}
`;
}
