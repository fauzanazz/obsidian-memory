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

export interface FeatureNoteOptions {
  project: string;
  slug: string;
  title: string;
  date: string;
  status: "draft" | "in-progress" | "completed" | "deprecated";
  categories?: string[];
  decidedBy?: string[];
  sessions?: string[];
  summary?: string;
  keyFiles?: Array<{ path: string; role: string }>;
  limitations?: string[];
}

export function featureNote(options: FeatureNoteOptions): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push("type: feature-note");
  lines.push(`project: ${options.project}`);
  lines.push(`feature: ${options.slug}`);
  lines.push(`created: ${options.date}`);
  lines.push(`updated: ${options.date}`);
  lines.push(`status: ${options.status}`);

  if (options.categories?.length) {
    lines.push("categories:");
    for (const c of options.categories) lines.push(`  - ${c}`);
  }

  if (options.decidedBy?.length) {
    lines.push("decided_by:");
    for (const d of options.decidedBy) lines.push(`  - ${d}`);
  }

  if (options.sessions?.length) {
    lines.push("sessions:");
    for (const s of options.sessions) lines.push(`  - ${s}`);
  }

  lines.push("tags:");
  lines.push("  - feature");
  lines.push(`  - project/${options.project}`);
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# ${options.title}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  if (options.summary) {
    lines.push(options.summary);
  } else {
    lines.push("<!-- Agent: describe what this feature does -->");
  }
  lines.push("");

  // How It Works
  lines.push("## How It Works");
  lines.push("<!-- Agent: explain the implementation approach -->");
  lines.push("");

  // Key Files
  lines.push("## Key Files");
  if (options.keyFiles?.length) {
    lines.push("| File | Role |");
    lines.push("|------|------|");
    for (const kf of options.keyFiles) {
      lines.push(`| \`${kf.path}\` | ${kf.role} |`);
    }
  } else {
    lines.push("<!-- Agent: add key files as | `path` | role | rows -->");
  }
  lines.push("");

  // Decisions & Trade-offs
  lines.push("## Decisions & Trade-offs");
  if (options.decidedBy?.length) {
    for (const d of options.decidedBy) {
      lines.push(`- [[${d}]]`);
    }
  } else {
    lines.push("<!-- Agent: link to ADRs or describe trade-offs -->");
  }
  lines.push("");

  // Known Limitations
  lines.push("## Known Limitations");
  if (options.limitations?.length) {
    for (const l of options.limitations) lines.push(`- ${l}`);
  } else {
    lines.push("<!-- Agent: document known limitations -->");
  }
  lines.push("");

  // Related
  lines.push("## Related");
  lines.push(`- Project: [[${options.project}/context|${options.project}]]`);
  lines.push(`- Features: [[Features|Feature Index]]`);
  if (options.sessions?.length) {
    for (const s of options.sessions) {
      lines.push(`- Session: [[${s}]]`);
    }
  }
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
