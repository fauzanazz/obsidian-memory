import { join } from "path";
import { access } from "fs/promises";

export const VAULT_FOLDERS = [
  "Memory",
  "Memory/Projects",
  "Memory/Conventions",
  "Memory/Sessions",
  "Memory/Journal",
  "Memory/Templates",
];

export interface VaultFile {
  path: string;
  content: string;
}

export interface VaultStructure {
  folders: string[];
  files: VaultFile[];
}

export interface VaultHealth {
  healthy: boolean;
  missingFolders: string[];
}

export function getVaultStructure(project: string): VaultStructure {
  const folders = [
    ...VAULT_FOLDERS,
    `Memory/Projects/${project}`,
    `Memory/Projects/${project}/Docs`,
    `Memory/Projects/${project}/Features`,
    `Memory/Sessions/${project}`,
  ];

  const files: VaultFile[] = [
    {
      path: "Memory/Index.md",
      content: `---
type: index
updated: ${today()}
---

# Memory Index

Welcome to your AI memory vault. This index is auto-maintained.

## Projects
- [[${project}/context|${project}]]

## Quick Links
- [[Templates/session|Session Template]]
- [[Templates/project|Project Template]]
- [[Templates/decision|Decision Template]]

## Recent Sessions
<!-- Auto-updated by obsidian-memory -->
`,
    },
    {
      path: `Memory/Projects/${project}/context.md`,
      content: `---
type: project
project: ${project}
created: ${today()}
updated: ${today()}
tags:
  - project/${project}
---

# ${project}

## Tech Stack
<!-- Describe the technology stack -->

## Architecture
<!-- Describe the project architecture -->

## Conventions
<!-- Key coding conventions -->

## Notes
<!-- Additional context -->
`,
    },
    {
      path: `Memory/Projects/${project}/decisions.md`,
      content: `---
type: decisions
project: ${project}
created: ${today()}
updated: ${today()}
tags:
  - project/${project}
  - decisions
---

# Decisions — ${project}

<!-- Architecture Decision Records (ADR) style log -->
<!-- Newest entries at the top -->
`,
    },
    {
      path: `Memory/Projects/${project}/progress.md`,
      content: `---
type: progress
project: ${project}
created: ${today()}
updated: ${today()}
tags:
  - project/${project}
  - progress
---

# Progress — ${project}

## Current State
<!-- What's the current state of the project? -->

## In Progress
<!-- What's actively being worked on? -->

## Blockers
<!-- Any blockers or questions? -->

## Completed
<!-- Recently completed items -->
`,
    },
    {
      path: "Memory/Templates/session.md",
      content: `---
type: session
agent: "{{agent}}"
project: "{{project}}"
created: "{{date}}"
updated: "{{date}}"
tags:
  - session
---

# Session — {{date}} — {{agent}}

## Summary
{{summary}}

## Decisions Made
{{decisions}}

## Files Modified
{{files}}

## Open Questions / Blockers
{{blockers}}

## Next Steps
{{next_steps}}
`,
    },
    {
      path: "Memory/Templates/project.md",
      content: `---
type: project
project: "{{project}}"
created: "{{date}}"
updated: "{{date}}"
tags:
  - project
---

# {{project}}

## Tech Stack

## Architecture

## Conventions

## Notes
`,
    },
    {
      path: "Memory/Templates/decision.md",
      content: `---
type: decision
project: "{{project}}"
created: "{{date}}"
status: accepted
tags:
  - decision
---

# Decision: {{title}}

## Context
<!-- What is the issue that we're seeing that is motivating this decision? -->

## Decision
<!-- What is the change that we're proposing and/or doing? -->

## Consequences
<!-- What becomes easier or more difficult to do because of this change? -->
`,
    },
  ];

  return { folders, files };
}

export async function validateVaultHealth(vaultPath: string): Promise<VaultHealth> {
  const missingFolders: string[] = [];

  for (const folder of VAULT_FOLDERS) {
    try {
      await access(join(vaultPath, folder));
    } catch {
      missingFolders.push(folder);
    }
  }

  return {
    healthy: missingFolders.length === 0,
    missingFolders,
  };
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}
