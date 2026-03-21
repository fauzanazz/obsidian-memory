import { renderTree } from "./scanner";
import type { ScanResult } from "./scanner";
import type { ProjectInfo } from "./project-detector";

export const AUTO_START = (section: string) =>
  `<!-- obsidian-memory:auto-start:${section} -->`;
export const AUTO_END = (section: string) =>
  `<!-- obsidian-memory:auto-end:${section} -->`;

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function frontmatter(project: string): string {
  return `---
type: documentation
project: ${project}
created: ${today()}
updated: ${today()}
tags:
  - project/${project}
  - documentation
---`;
}

export function generateArchitecture(
  project: string,
  scan: ScanResult,
  info: ProjectInfo
): string {
  const tree = renderTree(scan.tree);

  const entryPointLines = info.entryPoints.length > 0
    ? info.entryPoints.map((e) => `- \`${e.path}\` (${e.source})`).join("\n")
    : "_No entry points detected._";

  return `${frontmatter(project)}

# Architecture — ${project}

## Project Structure

${AUTO_START("structure")}
\`\`\`
${tree}
\`\`\`
${AUTO_END("structure")}

## Entry Points

${AUTO_START("entry-points")}
${entryPointLines}
${AUTO_END("entry-points")}

## System Overview
<!-- Agent: describe how the system works at a high level -->

## Key Patterns
<!-- Agent: document architectural patterns used in this project -->

---

See also: [[Features]], [[Modules]], [[Conventions]]
`;
}

export function generateFeatures(project: string): string {
  return `${frontmatter(project)}

# Features — ${project}

> Before creating new functionality, check if it already exists here.

## Feature Inventory

| Feature | Status | Module | Files | Description |
|---------|--------|--------|-------|-------------|
<!-- Agent: add features as they are implemented -->

## Implementation Notes
<!-- Agent: add notes about how features work, edge cases, and dependencies -->

---

See also: [[Architecture]], [[Modules]], [[Conventions]]
`;
}

export function generateModules(project: string, info: ProjectInfo): string {
  const moduleRows = info.modules.length > 0
    ? info.modules
        .map(
          (m) =>
            `| ${m.directory} | ${m.entryFile || "-"} | ${m.fileCount} | <!-- purpose --> |`
        )
        .join("\n")
    : "| _No modules detected_ | - | - | - |";

  return `${frontmatter(project)}

# Modules — ${project}

> Use this index to find the right file before debugging or implementing.

## Module Index

${AUTO_START("modules")}
| Directory | Entry File | Files | Purpose |
|-----------|-----------|-------|---------|
${moduleRows}
${AUTO_END("modules")}

## Module Details
<!-- Agent: add detailed descriptions of each module's responsibility -->

---

See also: [[Architecture]], [[Features]], [[Conventions]]
`;
}

export function generateConventions(project: string): string {
  return `${frontmatter(project)}

# Conventions — ${project}

## Coding Patterns
<!-- Agent: document patterns discovered while working (e.g., error handling, state management) -->

## Naming Conventions
<!-- Agent: document naming conventions (files, functions, variables, routes) -->

## Common Gotchas
<!-- Agent: document gotchas, pitfalls, and things that are easy to get wrong -->

## Testing Patterns
<!-- Agent: document how tests are structured and run -->

---

See also: [[Architecture]], [[Features]], [[Modules]]
`;
}

/**
 * Merge new generated content with existing content.
 * Replaces auto-generated sections (between markers) while preserving
 * everything else (agent-written content).
 */
export function mergeWithExisting(
  newContent: string,
  existingContent: string
): string {
  if (!existingContent) return newContent;

  // Extract auto sections from new content
  const autoSectionRegex =
    /<!-- obsidian-memory:auto-start:(\w[\w-]*) -->\n([\s\S]*?)<!-- obsidian-memory:auto-end:\1 -->/g;

  const newSections = new Map<string, string>();
  let match;
  while ((match = autoSectionRegex.exec(newContent)) !== null) {
    newSections.set(match[1], match[0]);
  }

  if (newSections.size === 0) return newContent;

  // Check if existing content has any auto sections
  const existingHasAuto = /<!-- obsidian-memory:auto-start:/.test(existingContent);

  if (!existingHasAuto) {
    // Existing content has no auto sections — use new content entirely
    return newContent;
  }

  // Replace auto sections in existing content with new ones
  let merged = existingContent;
  const replaceRegex =
    /<!-- obsidian-memory:auto-start:(\w[\w-]*) -->\n[\s\S]*?<!-- obsidian-memory:auto-end:\1 -->/g;

  merged = merged.replace(replaceRegex, (fullMatch, sectionName) => {
    const newSection = newSections.get(sectionName);
    return newSection || fullMatch;
  });

  // Update the frontmatter 'updated' date
  merged = merged.replace(
    /^(updated:\s*)\S+/m,
    `$1${today()}`
  );

  return merged;
}
