import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";

export type LoadContextTier = "minimal" | "default" | "focus" | "full";

export interface LoadContextOptions {
  tier?: LoadContextTier;
  focus?: string;
  includeConventions?: boolean;
  includeDecisions?: boolean;
  includeSessions?: number;
}

const DEFAULTS: Required<Omit<LoadContextOptions, "focus">> = {
  tier: "default",
  includeConventions: true,
  includeDecisions: true,
  includeSessions: 3,
};

export async function runLoadContext(
  cwd: string,
  options?: LoadContextOptions
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  if (opts.focus) opts.tier = "focus";

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);
  const sections: string[] = [];

  // Tier 1: Always loaded
  await loadTier1(cli, project, sections);

  if (opts.tier === "minimal") {
    return formatOutput(project, sections);
  }

  // Tier 2: Compact indexes
  await loadTier2(cli, project, sections, opts);

  if (opts.tier === "default") {
    return formatOutput(project, sections);
  }

  // Tier 3 (focus mode): Full content for matching notes
  if (opts.tier === "focus" && opts.focus) {
    await loadFocused(cli, project, sections, opts.focus);
    return formatOutput(project, sections);
  }

  // Full mode: Everything (backwards compatible)
  await loadFull(cli, project, sections, opts);
  return formatOutput(project, sections);
}

function formatOutput(project: string, sections: string[]): string {
  if (sections.length === 0) {
    return "# Memory Context\n\n_No memory found for this project._";
  }
  return `# Memory Context — ${project}\n\n` + sections.join("\n\n---\n\n");
}

// ── Tier 1: Always loaded (~500 tokens) ──────────────────────

async function loadTier1(
  cli: ObsidianCLI,
  project: string,
  sections: string[]
): Promise<void> {
  // Project summary — extract first paragraph from context.md
  try {
    const context = await cli.read({
      path: `Memory/Projects/${project}/context.md`,
    });
    const summary = extractSummary(context);
    sections.push("## Project\n\n" + summary);
  } catch {
    sections.push("## Project\n\n_No project context found._");
  }

  // Current state + blockers from progress.md
  try {
    const progress = await cli.read({
      path: `Memory/Projects/${project}/progress.md`,
    });
    const compact = extractProgressCompact(progress);
    if (compact) sections.push("## Current State\n\n" + compact);
  } catch {
    // optional
  }

  // Last session's next steps (most recent session only)
  try {
    const results = await cli.search(project, {
      path: "Memory/Sessions/",
      limit: 1,
    });
    if (results.length > 0) {
      const content = await cli.read({ path: results[0].path });
      const nextSteps = extractSection(content, "Next Steps");
      const summary = extractSection(content, "Summary");
      if (summary || nextSteps) {
        const parts: string[] = [];
        if (summary) parts.push(`**Last session:** ${summary.trim()}`);
        if (nextSteps) parts.push(`**Pending next steps:**\n${nextSteps}`);
        sections.push("## Continuity\n\n" + parts.join("\n\n"));
      }
    }
  } catch {
    // optional
  }
}

// ── Tier 2: Compact indexes (~2000 tokens) ───────────────────

async function loadTier2(
  cli: ObsidianCLI,
  project: string,
  sections: string[],
  opts: Required<Omit<LoadContextOptions, "focus">>
): Promise<void> {
  // Feature index (one-line per feature)
  try {
    const featuresDoc = await cli.read({
      path: `Memory/Projects/${project}/Docs/Features.md`,
    });
    const index = extractSection(featuresDoc, "Feature Index");
    if (index?.trim()) {
      sections.push("## Features\n\n" + index.trim());
    }
  } catch {}

  // Decision index (one-line per ADR)
  if (opts.includeDecisions) {
    try {
      const decisionsDoc = await cli.read({
        path: `Memory/Projects/${project}/decisions.md`,
      });
      const log = extractSection(decisionsDoc, "Decision Log");
      if (log?.trim()) {
        sections.push("## Decisions\n\n" + log.trim());
      } else {
        // Backwards compat: old inline format
        sections.push("## Decisions\n\n" + decisionsDoc);
      }
    } catch {}
  }

  // Module index (directory → purpose, one-line each)
  try {
    const modulesDocs = await cli.read({
      path: `Memory/Projects/${project}/Docs/Modules.md`,
    });
    const moduleIndex = extractSection(modulesDocs, "Module Index");
    if (moduleIndex?.trim()) {
      sections.push("## Modules\n\n" + moduleIndex.trim());
    }
  } catch {}

  // Recent sessions (one-line summaries, not full content)
  if (opts.includeSessions > 0) {
    try {
      const results = await cli.search(project, {
        path: `Memory/Sessions/${project}/`,
        limit: opts.includeSessions,
      });
      if (results.length > 0) {
        const lines: string[] = [];
        for (const result of results) {
          try {
            const content = await cli.read({ path: result.path });
            const summary = extractSection(content, "Summary");
            const filename = result.path.split("/").pop() || "";
            lines.push(
              `- [[${filename}]]: ${truncate(summary?.trim() || "No summary", 120)}`
            );
          } catch {}
        }
        if (lines.length > 0) {
          sections.push("## Recent Sessions\n\n" + lines.join("\n"));
        }
      }
    } catch {}
  }

  // Conventions (compact, if enabled)
  if (opts.includeConventions) {
    try {
      const results = await cli.search("convention", {
        path: "Memory/Conventions/",
      });
      for (const result of results.slice(0, 3)) {
        try {
          const content = await cli.read({ path: result.path });
          sections.push("## Convention\n\n" + truncate(content, 500));
        } catch {}
      }
    } catch {}
  }
}

// ── Focus loader: keyword-filtered deep content ──────────────

async function loadFocused(
  cli: ObsidianCLI,
  project: string,
  sections: string[],
  keyword: string
): Promise<void> {
  // Search across all project memory for matching notes
  const results = await cli.search(keyword, {
    path: `Memory/Projects/${project}/`,
    limit: 10,
  });

  // Also search sessions
  const sessionResults = await cli.search(keyword, {
    path: "Memory/Sessions/",
    limit: 5,
  });

  const allResults = [...results, ...sessionResults];

  if (allResults.length === 0) {
    sections.push(`## Focus: "${keyword}"\n\n_No matching notes found._`);
    return;
  }

  const focusedSections: string[] = [];
  for (const result of allResults) {
    try {
      const content = await cli.read({ path: result.path });
      const filename = result.path.split("/").pop() || "";
      focusedSections.push(`### ${filename}\n\n${content}`);
    } catch {}
  }

  if (focusedSections.length > 0) {
    sections.push(
      `## Focus: "${keyword}" (${focusedSections.length} notes)\n\n` +
        focusedSections.join("\n\n---\n\n")
    );
  }
}

// ── Full loader: everything (backwards compatible) ───────────

async function loadFull(
  cli: ObsidianCLI,
  project: string,
  sections: string[],
  opts: Required<Omit<LoadContextOptions, "focus">>
): Promise<void> {
  // Full project context (entire context.md)
  try {
    const context = await cli.read({
      path: `Memory/Projects/${project}/context.md`,
    });
    const projectIdx = sections.findIndex((s) => s.startsWith("## Project"));
    if (projectIdx !== -1) {
      sections[projectIdx] = "## Project Context\n\n" + context;
    }
  } catch {}

  // Full progress file
  try {
    const progress = await cli.read({
      path: `Memory/Projects/${project}/progress.md`,
    });
    const stateIdx = sections.findIndex((s) =>
      s.startsWith("## Current State")
    );
    if (stateIdx !== -1) {
      sections[stateIdx] = "## Progress\n\n" + progress;
    }
  } catch {}

  // Full module documentation
  try {
    const modulesDocs = await cli.read({
      path: `Memory/Projects/${project}/Docs/Modules.md`,
    });
    sections.push("## Module Documentation\n\n" + modulesDocs);
  } catch {}

  // Full session content (replace one-line summaries with full notes)
  if (opts.includeSessions > 0) {
    try {
      const results = await cli.search(project, {
        path: `Memory/Sessions/${project}/`,
        limit: opts.includeSessions,
      });
      const sessionContent: string[] = [];
      for (const result of results) {
        try {
          const content = await cli.read({ path: result.path });
          // Skip archived sessions (distilled into journal entries)
          if (content.includes("archived: true")) continue;
          sessionContent.push(content);
        } catch {}
      }
      if (sessionContent.length > 0) {
        const sessIdx = sections.findIndex((s) =>
          s.startsWith("## Recent Sessions")
        );
        if (sessIdx !== -1) {
          sections[sessIdx] =
            "## Recent Sessions\n\n" + sessionContent.join("\n\n---\n\n");
        }
      }
    } catch {}
  }
}

// ── Helper functions ─────────────────────────────────────────

/**
 * Extract the first meaningful paragraph from a note (skipping frontmatter and headers).
 */
export function extractSummary(content: string): string {
  // Strip frontmatter
  const stripped = content.replace(/^---[\s\S]*?---\n*/, "");
  // Strip the first H1 header
  const noH1 = stripped.replace(/^# .+\n*/, "");
  // Find first paragraph (non-empty line that isn't a header or list)
  const lines = noH1.split("\n");
  const paragraphLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) break;
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    if (trimmed.startsWith("## ")) {
      if (inParagraph) break;
      continue;
    }
    paragraphLines.push(trimmed);
    inParagraph = true;
  }

  return paragraphLines.join("\n") || "_No summary available._";
}

/**
 * Extract compact progress: Current State + Blockers only.
 */
export function extractProgressCompact(content: string): string | null {
  const currentState = extractSection(content, "Current State");
  const blockers = extractSection(content, "Blockers");

  const parts: string[] = [];
  if (currentState?.trim()) parts.push("**Current state:**\n" + currentState.trim());
  if (blockers?.trim()) parts.push("**Blockers:**\n" + blockers.trim());

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Extract content under a ## heading until the next ## or end of file.
 */
export function extractSection(
  content: string,
  heading: string
): string | null {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`);
  const match = content.match(regex);
  return match ? match[1] : null;
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
