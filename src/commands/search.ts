import { findConfig, openStore, getEmbeddingsPath } from "../lib/config";
import { expandQuery } from "../lib/query-expander";
import { hybridSearch } from "../lib/retrieval";
import { loadEmbeddingsFile } from "../lib/embeddings-bin";
import { embedQuery } from "../lib/embeddings";
import type { RankedResult } from "../lib/types";

export interface SearchCommandOptions {
  path?: string;
  limit?: number;
}

export async function runSearch(
  cwd: string,
  query: string,
  options?: SearchCommandOptions,
): Promise<{ results: RankedResult[]; provider: string }> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory config found. Run `obsidian-memory init` first.",
    );
  }

  const store = openStore(found.dir, found.config);
  const apiKey = process.env.GEMINI_API_KEY;

  // Expand query (LLM-powered if API key available)
  const expanded = await expandQuery(query, apiKey);

  // Load embeddings + embed query if available
  const embPath = getEmbeddingsPath(found.dir);
  const embIndex = await loadEmbeddingsFile(embPath);
  let queryVector: Float32Array | null = null;
  if (apiKey && embIndex) {
    try {
      const vec = await embedQuery(query, apiKey);
      if (vec.length > 0) queryVector = new Float32Array(vec);
    } catch {
      // Vector search unavailable — keyword only
    }
  }

  const results = hybridSearch(store, expanded, embIndex, queryVector, {
    limit: options?.limit,
    target: "all",
  });

  const provider = queryVector ? "hybrid (keyword + vector)" : "keyword (FTS5)";

  store.close();
  return { results, provider };
}

export function formatSearchResults(
  results: RankedResult[],
  provider: string,
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s) via ${provider}:\n`);

  for (const result of results) {
    const sourceTag = ` [${result.sources.join("+")}]`;
    if (result.type === "session") {
      lines.push(`  ${result.id}${sourceTag}`);
      if (result.summary) {
        lines.push(`    > ${result.summary.slice(0, 120)}`);
      }
    } else {
      lines.push(`  ${result.subject} ${result.action} ${result.object}${sourceTag}`);
      if (result.date) {
        lines.push(`    > ${result.date}`);
      }
    }
  }

  return lines.join("\n");
}
