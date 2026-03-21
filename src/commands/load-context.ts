import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";

export interface LoadContextOptions {
  includeConventions?: boolean;
  includeDecisions?: boolean;
  includeSessions?: number; // number of recent sessions to include
}

const DEFAULTS: Required<LoadContextOptions> = {
  includeConventions: true,
  includeDecisions: true,
  includeSessions: 3,
};

export async function runLoadContext(
  cwd: string,
  options?: LoadContextOptions
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);
  const sections: string[] = [];

  // Load project context
  try {
    const context = await cli.read({
      path: `Memory/Projects/${project}/context.md`,
    });
    sections.push("## Project Context\n\n" + context);
  } catch {
    sections.push("## Project Context\n\n_No project context found._");
  }

  // Load progress
  try {
    const progress = await cli.read({
      path: `Memory/Projects/${project}/progress.md`,
    });
    sections.push("## Progress\n\n" + progress);
  } catch {
    // Progress file is optional
  }

  // Load decisions
  if (opts.includeDecisions) {
    try {
      const decisions = await cli.read({
        path: `Memory/Projects/${project}/decisions.md`,
      });
      sections.push("## Decisions\n\n" + decisions);
    } catch {
      // Decisions file is optional
    }
  }

  // Load module documentation (for debugging and anti-duplication)
  try {
    const modulesDocs = await cli.read({
      path: `Memory/Projects/${project}/Docs/Modules.md`,
    });
    sections.push("## Module Documentation\n\n" + modulesDocs);
  } catch {
    // Docs not generated yet — skip silently
  }

  // Load conventions
  if (opts.includeConventions) {
    try {
      const results = await cli.search("convention", {
        path: "Memory/Conventions/",
      });
      for (const result of results.slice(0, 5)) {
        try {
          const content = await cli.read({ path: result.path });
          sections.push("## Convention\n\n" + content);
        } catch {
          // Skip unreadable conventions
        }
      }
    } catch {
      // No conventions found
    }
  }

  // Load recent sessions
  if (opts.includeSessions > 0) {
    try {
      const results = await cli.search(project, {
        path: "Memory/Sessions/",
        limit: opts.includeSessions,
      });
      if (results.length > 0) {
        const sessionSections: string[] = [];
        for (const result of results) {
          try {
            const content = await cli.read({ path: result.path });
            sessionSections.push(content);
          } catch {
            // Skip unreadable sessions
          }
        }
        if (sessionSections.length > 0) {
          sections.push(
            "## Recent Sessions\n\n" + sessionSections.join("\n\n---\n\n")
          );
        }
      }
    } catch {
      // No sessions found
    }
  }

  if (sections.length === 0) {
    return "# Memory Context\n\n_No memory found for this project. Start working and save a session to build memory._";
  }

  return `# Memory Context — ${project}\n\n` + sections.join("\n\n---\n\n");
}
