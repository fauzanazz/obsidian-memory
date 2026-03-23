import { ObsidianCLI, type SearchResult } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { distillSessions } from "../lib/distiller";
import { journalNote, decisionNote } from "../templates/note-templates";
import type { LLMConfig } from "../lib/llm";

export interface ConsolidateOptions {
  daysThreshold?: number; // consolidate sessions older than N days (default 30)
  auto?: boolean; // auto-merge without confirmation
  distill?: boolean; // use LLM for knowledge distillation
}

export interface ConsolidateResult {
  sessionsFound: number;
  grouped: Map<string, SearchResult[]>;
  message: string;
}

export async function runConsolidate(
  cwd: string,
  options?: ConsolidateOptions
): Promise<ConsolidateResult> {
  const threshold = options?.daysThreshold ?? 30;

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);

  // Search for sessions for this project
  const results = await cli.search("session", {
    path: `Memory/Sessions/${project}/`,
  });

  if (results.length === 0) {
    return {
      sessionsFound: 0,
      grouped: new Map(),
      message: "No sessions found to consolidate.",
    };
  }

  // Group sessions by date prefix (YYYY-MM)
  const grouped = new Map<string, SearchResult[]>();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - threshold);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  for (const result of results) {
    // Extract date from filename: Memory/Sessions/YYYY-MM-DD-agent-hash.md
    const filename = result.path.split("/").pop() || "";
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const sessionDate = dateMatch[1];
    if (sessionDate > cutoff) continue; // Skip recent sessions

    const month = sessionDate.slice(0, 7); // YYYY-MM
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month)!.push(result);
  }

  const totalOld = Array.from(grouped.values()).reduce(
    (sum, g) => sum + g.length,
    0
  );

  if (totalOld === 0) {
    return {
      sessionsFound: results.length,
      grouped,
      message: `Found ${results.length} sessions, but none older than ${threshold} days.`,
    };
  }

  // LLM-powered distillation (new path)
  if (options?.distill) {
    const llmConfig: LLMConfig | undefined = (found.config as any).llm;
    const apiKeyEnv = llmConfig?.apiKeyEnv ?? "GEMINI_API_KEY";

    if (!process.env[apiKeyEnv]) {
      console.log(
        `[consolidate] LLM key (${apiKeyEnv}) not set, falling back to summary-only mode.`
      );
      // Force auto mode so the fallback path actually executes
      options = { ...options, auto: true };
      // Fall through to existing --auto behavior below
    } else {
      // Load canonical docs for context
      const projectContext = await safeRead(
        cli,
        `Memory/Projects/${project}/context.md`
      );
      const progress = await safeRead(
        cli,
        `Memory/Projects/${project}/progress.md`
      );
      const featureIndex = await safeRead(
        cli,
        `Memory/Projects/${project}/Docs/Features.md`
      );
      const decisionIndex = await safeRead(
        cli,
        `Memory/Projects/${project}/decisions.md`
      );

      for (const [month, sessions] of grouped) {
        // Read all session contents
        const sessionData: Array<{
          path: string;
          content: string;
          date: string;
        }> = [];
        for (const session of sessions) {
          try {
            const content = await cli.read({ path: session.path });
            // Skip already-archived sessions
            if (content.includes("archived: true")) continue;
            const filename = session.path.split("/").pop() || "";
            const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
            sessionData.push({
              path: session.path,
              content,
              date: dateMatch?.[1] || "",
            });
          } catch {
            // Skip unreadable sessions
          }
        }

        if (sessionData.length === 0) continue;

        // Call LLM for distillation
        const distillation = await distillSessions(
          sessionData,
          projectContext,
          progress,
          featureIndex,
          decisionIndex,
          llmConfig
        );

        // 1. Create rich journal entry
        const journalContent = journalNote({
          project,
          period: month,
          themes: distillation.journal.themes,
          accomplishments: distillation.journal.accomplishments,
          decisionsSummary: distillation.journal.decisionsSummary,
          patternsObserved: distillation.journal.patternsObserved,
          outstandingBlockers: distillation.journal.outstandingBlockers,
          weeklyBreakdown: distillation.journal.weeklyBreakdown,
          sessionsArchived: sessionData.length,
        });

        try {
          await cli.create({
            name: `Memory/Journal/${month}`,
            content: journalContent,
            overwrite: true,
          });
        } catch {
          await cli.create({
            name: `Memory/Journal/${month}`,
            content: journalContent,
            silent: true,
          });
        }

        // 2. Apply context updates
        if (distillation.contextUpdates) {
          await applyContextUpdates(
            cli,
            project,
            distillation.contextUpdates
          );
        }

        // 3. Create new decision notes
        for (const decision of distillation.newDecisions) {
          try {
            const date = new Date().toISOString().split("T")[0];
            const slug = decision.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "");
            const content = decisionNote({
              project,
              date,
              title: decision.title,
              context: decision.context,
              decision: decision.decision,
              consequences: decision.consequences,
            });
            await cli.create({
              name: `Memory/Projects/${project}/Decisions/${slug}`,
              content,
              silent: true,
            });
          } catch {
            // Decision may already exist
          }
        }

        // 4. Create new feature notes
        for (const feature of distillation.newFeatures) {
          try {
            const content = featureNote({
              project,
              slug: feature.slug,
              title: feature.title,
              summary: feature.summary,
              status: feature.status,
            });
            await cli.create({
              name: `Memory/Projects/${project}/Docs/Features/${feature.slug}`,
              content,
              silent: true,
            });
          } catch {
            // Feature may already exist
          }
        }

        // 5. Tag sessions as archived
        for (const session of sessionData) {
          await archiveSession(cli, session.path, session.content);
        }
      }

      return {
        sessionsFound: results.length,
        grouped,
        message: `Distilled ${totalOld} sessions across ${grouped.size} month(s) into enriched journal entries.`,
      };
    }
  }

  // If auto mode, merge sessions into monthly journal entries (lossy fallback)
  if (options?.auto) {
    for (const [month, sessions] of grouped) {
      const summaries: string[] = [];
      for (const session of sessions) {
        try {
          const content = await cli.read({ path: session.path });
          // Extract just the summary section
          const summaryMatch = content.match(
            /## Summary\n([\s\S]*?)(?=\n## |$)/
          );
          if (summaryMatch) {
            summaries.push(
              `- ${session.path.split("/").pop()}: ${summaryMatch[1].trim()}`
            );
          }
        } catch {
          // Skip unreadable sessions
        }
      }

      if (summaries.length > 0) {
        const journalContent = `\n\n## ${month} — Consolidated Sessions\n\n${summaries.join("\n")}\n`;
        try {
          await cli.append({
            path: `Memory/Journal/${month}.md`,
            content: journalContent,
          });
        } catch {
          // Journal file may not exist — create it
          await cli.create({
            name: `Memory/Journal/${month}`,
            content: `---\ntype: journal\nperiod: ${month}\ncreated: ${new Date().toISOString().split("T")[0]}\ntags:\n  - journal\n---\n\n# Journal — ${month}\n${journalContent}`,
            silent: true,
          });
        }
      }
    }

    return {
      sessionsFound: results.length,
      grouped,
      message: `Consolidated ${totalOld} sessions across ${grouped.size} month(s) into journal entries.`,
    };
  }

  return {
    sessionsFound: results.length,
    grouped,
    message: `Found ${totalOld} sessions older than ${threshold} days across ${grouped.size} month(s). Run with --auto to consolidate.`,
  };
}

async function safeRead(cli: ObsidianCLI, path: string): Promise<string> {
  try {
    return await cli.read({ path });
  } catch {
    return "";
  }
}

async function applyContextUpdates(
  cli: ObsidianCLI,
  project: string,
  updates: {
    currentState: string | null;
    techStack: string | null;
    architecture: string | null;
  }
): Promise<void> {
  if (updates.currentState) {
    try {
      const progress = await cli.read({
        path: `Memory/Projects/${project}/progress.md`,
      });
      const updated = progress.replace(
        /## Current State\n[\s\S]*?(?=\n## |$)/,
        `## Current State\n${updates.currentState}\n\n`
      );
      await cli.create({
        name: `Memory/Projects/${project}/progress.md`,
        content: updated,
        overwrite: true,
      });
    } catch {
      // Progress file may not exist
    }
  }

  if (updates.techStack || updates.architecture) {
    try {
      let context = await cli.read({
        path: `Memory/Projects/${project}/context.md`,
      });
      if (updates.techStack) {
        context = context.replace(
          /## Tech Stack\n[\s\S]*?(?=\n## |$)/,
          `## Tech Stack\n${updates.techStack}\n\n`
        );
      }
      if (updates.architecture) {
        context = context.replace(
          /## Architecture\n[\s\S]*?(?=\n## |$)/,
          `## Architecture\n${updates.architecture}\n\n`
        );
      }
      await cli.create({
        name: `Memory/Projects/${project}/context.md`,
        content: context,
        overwrite: true,
      });
    } catch {
      // Context file may not exist
    }
  }
}

async function archiveSession(
  cli: ObsidianCLI,
  sessionPath: string,
  content: string
): Promise<void> {
  if (content.includes("archived: true")) return;

  const updated = content.replace(
    /^(---\n[\s\S]*?)(---)/m,
    `$1archived: true\n$2`
  );

  await cli.create({
    name: sessionPath,
    content: updated,
    overwrite: true,
  });
}

function featureNote(options: {
  project: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
}): string {
  const date = new Date().toISOString().split("T")[0];
  return `---
type: feature
project: ${options.project}
created: ${date}
status: ${options.status}
tags:
  - feature
  - project/${options.project}
---

# ${options.title}

${options.summary}
`;
}
