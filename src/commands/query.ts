import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig, resolveVaultPath } from "../lib/config";
import { readEvents, searchEvents, formatEventTimeline } from "../lib/event-extractor";
import { vectorSearch, reciprocalRankFusion } from "../lib/embeddings";
import { extractSection } from "./load-context";

export interface QueryOptions {
  since?: string;
  until?: string;
  limit?: number;
}

export async function runQuery(
  cwd: string,
  queryText: string,
  options: QueryOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory.json found. Run `obsidian-memory init` first.");
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);
  const vaultPath = resolveVaultPath(found.config);

  if (!vaultPath) {
    throw new Error("Could not resolve vault filesystem path. Set vaultPath in .obsidian-memory.json.");
  }

  const sections: string[] = [];
  sections.push(`# Query: "${queryText}"`);

  // 1. Search events
  const allEvents = await readEvents(vaultPath, project, {
    since: options.since,
    until: options.until,
  });
  const matchedEvents = searchEvents(allEvents, queryText);
  const limitedEvents = matchedEvents.slice(0, options.limit ?? 10);

  if (limitedEvents.length > 0) {
    sections.push(`## Matching Events (${limitedEvents.length})\n\n${formatEventTimeline(limitedEvents)}`);
  } else {
    sections.push("## Events\n\nNo matching events found.");
  }

  // 2. Find related sessions (via event sources + hybrid search)
  const sessionPaths = new Set<string>();

  // Sessions from matching events
  for (const event of limitedEvents) {
    if (event.source) sessionPaths.add(event.source);
  }

  // Hybrid search for additional sessions
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const vectorResults = await vectorSearch(vaultPath, queryText, apiKey, 5);
      const keywordResults = await cli.search(queryText, {
        path: `Memory/Sessions/${project}/`,
        limit: 5,
      });
      const fused = reciprocalRankFusion(
        keywordResults.map((r) => r.path),
        vectorResults.filter((r) => r.path.includes(`Sessions/${project}/`)),
      );
      for (const result of fused.slice(0, 3)) {
        sessionPaths.add(result.path);
      }
    } catch {
      // Vector or fusion failed — fall back to keyword-only
      try {
        const results = await cli.search(queryText, {
          path: `Memory/Sessions/${project}/`,
          limit: 5,
        });
        for (const r of results) sessionPaths.add(r.path);
      } catch {}
    }
  } else {
    // Keyword-only fallback
    try {
      const results = await cli.search(queryText, {
        path: `Memory/Sessions/${project}/`,
        limit: 5,
      });
      for (const r of results) sessionPaths.add(r.path);
    } catch {
      // optional
    }
  }

  // 3. Load session summaries
  if (sessionPaths.size > 0) {
    const sessionLines: string[] = [];
    for (const path of Array.from(sessionPaths).slice(0, 5)) {
      try {
        const content = await cli.read({ path });
        const summary = extractSection(content, "Summary");
        const filename = path.split("/").pop() || "";
        sessionLines.push(`- **${filename}**: ${summary?.trim() || "No summary"}`);
      } catch {
        // Skip unreadable sessions
      }
    }
    if (sessionLines.length > 0) {
      sections.push(`## Related Sessions\n\n${sessionLines.join("\n")}`);
    }
  }

  return sections.join("\n\n");
}
