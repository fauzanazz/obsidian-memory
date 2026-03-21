import { ObsidianCLI, type SearchResult } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";

export interface ConsolidateOptions {
  daysThreshold?: number; // consolidate sessions older than N days (default 30)
  auto?: boolean; // auto-merge without confirmation
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
  const results = await cli.search(`project::${project}`, {
    path: "Memory/Sessions/",
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

  // If auto mode, merge sessions into monthly journal entries
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
