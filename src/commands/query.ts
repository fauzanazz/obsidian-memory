import { findConfig, openStore, getEmbeddingsPath } from "../lib/config";
import { expandQuery } from "../lib/query-expander";
import { loadEmbeddingsFile } from "../lib/embeddings-bin";
import { embedQuery } from "../lib/embeddings";
import { hybridSearch } from "../lib/retrieval";

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
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const apiKey = process.env.GEMINI_API_KEY;

  const sections: string[] = [];
  sections.push(`# Query: "${queryText}"`);

  // 1. Search events via FTS5
  const expanded = await expandQuery(queryText, apiKey);
  if (options.since) expanded.timeframe = { ...expanded.timeframe, since: options.since };
  if (options.until) expanded.timeframe = { ...expanded.timeframe, until: options.until };

  const matchedEvents = store.searchEventsFTS(
    expanded.terms.join(" OR "),
    expanded.timeframe,
    options.limit ?? 10,
  );

  if (matchedEvents.length > 0) {
    const eventLines: string[] = [];
    const byDate = new Map<string, typeof matchedEvents>();
    for (const event of matchedEvents) {
      const group = byDate.get(event.date) ?? [];
      group.push(event);
      byDate.set(event.date, group);
    }

    for (const date of Array.from(byDate.keys()).sort().reverse()) {
      eventLines.push(`## ${date}`);
      for (const event of byDate.get(date)!) {
        const filesStr = event.files ? ` (${event.files.split(" ").map((f: string) => "`" + f + "`").join(", ")})` : "";
        eventLines.push(`- **${event.subject}** ${event.action} ${event.object}${filesStr}`);
      }
      eventLines.push("");
    }

    sections.push(`## Matching Events (${matchedEvents.length})\n\n${eventLines.join("\n")}`);
  } else {
    sections.push("## Events\n\nNo matching events found.");
  }

  // 2. Find related sessions via hybrid search
  const embPath = getEmbeddingsPath(found.dir);
  let embIndex: Awaited<ReturnType<typeof loadEmbeddingsFile>> = null;
  try {
    embIndex = await loadEmbeddingsFile(embPath);
  } catch {
    // Corrupt or unreadable embeddings file — fall back to keyword-only search
  }
  let queryVector: Float32Array | null = null;
  if (apiKey && embIndex) {
    try {
      const vec = await embedQuery(queryText, apiKey);
      if (vec.length > 0) queryVector = new Float32Array(vec);
    } catch { /* keyword only */ }
  }

  const sessionResults = hybridSearch(store, expanded, embIndex, queryVector, {
    limit: 5,
    target: "sessions",
  });

  // Also include sessions referenced by matched events
  const sessionIds = new Set(sessionResults.map((r) => r.id));
  for (const event of matchedEvents.slice(0, 5)) {
    if (event.sessionId && !sessionIds.has(event.sessionId)) {
      sessionIds.add(event.sessionId);
    }
  }

  // 3. Load session summaries
  const sessionLines: string[] = [];
  for (const id of sessionIds) {
    const session = store.getSession(id);
    if (!session) continue;
    sessionLines.push(`- **${session.id}** (${session.date}): ${session.summary.slice(0, 120)}`);
  }

  if (sessionLines.length > 0) {
    sections.push(`## Related Sessions\n\n${sessionLines.join("\n")}`);
  }

  store.close();
  return sections.join("\n\n");
}
