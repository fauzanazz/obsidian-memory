import { ObsidianCLI, type SearchResult } from "./obsidian-cli";
import {
  vectorSearch,
  reciprocalRankFusion,
  type VectorSearchResult,
} from "./embeddings";

export interface SearchProvider {
  search(
    query: string,
    options?: { path?: string; limit?: number },
  ): Promise<SearchResult[]>;
  name: string;
}

export interface HybridSearchResult extends SearchResult {
  score?: number;
  sources?: Array<"keyword" | "vector">;
}

export class ObsidianSearchProvider implements SearchProvider {
  readonly name = "obsidian-cli";
  constructor(private cli: ObsidianCLI) {}

  async search(
    query: string,
    options?: { path?: string; limit?: number },
  ): Promise<SearchResult[]> {
    return this.cli.search(query, options);
  }
}

/**
 * Unified hybrid search provider.
 * Combines Obsidian CLI keyword search with built-in vector search.
 * Falls back to keyword-only if vector search is unavailable.
 */
export class UnifiedHybridProvider implements SearchProvider {
  readonly name = "hybrid (keyword + vector)";

  constructor(
    private cli: ObsidianCLI,
    private vaultPath: string,
    private apiKey: string,
  ) {}

  async search(
    query: string,
    options?: { path?: string; limit?: number },
  ): Promise<HybridSearchResult[]> {
    const limit = options?.limit ?? 10;

    // Run keyword and vector search in parallel
    const [keywordResults, vectorResults] = await Promise.all([
      this.cli.search(query, options).catch(() => [] as SearchResult[]),
      vectorSearch(this.vaultPath, query, this.apiKey, limit * 2).catch(
        () => [] as VectorSearchResult[],
      ),
    ]);

    // Filter vector results by path prefix if specified
    let filteredVector = vectorResults;
    if (options?.path) {
      filteredVector = vectorResults.filter((r) =>
        r.path.startsWith(options.path!),
      );
    }

    // Fuse results
    const fused = reciprocalRankFusion(
      keywordResults.map((r) => r.path),
      filteredVector,
    );

    // Convert to HybridSearchResult
    return fused.slice(0, limit).map((f) => ({
      path: f.path,
      matches: keywordResults.find((k) => k.path === f.path)?.matches ?? [],
      score: f.score,
      sources: f.sources,
    }));
  }
}

/**
 * Create the appropriate search provider based on available capabilities.
 * Prefers hybrid when GEMINI_API_KEY is available, falls back to keyword-only.
 */
export async function createSearchProvider(
  cli: ObsidianCLI,
  vaultPath?: string,
): Promise<SearchProvider> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && vaultPath) {
    return new UnifiedHybridProvider(cli, vaultPath, apiKey);
  }

  return new ObsidianSearchProvider(cli);
}

export { detectHybridSearch } from "./embeddings";
