/**
 * Hybrid retrieval pipeline for obsidian-memory v2.
 *
 * Combines FTS5 keyword search (BM25) with vector search (cosine similarity)
 * using Reciprocal Rank Fusion (k=60). Shared by search, query, and
 * load-context --task commands.
 */

import type { MemoryStore } from "./store";
import type {
  ExpandedQuery,
  RankedResult,
  VectorResult,
  BinEmbeddingIndex,
  SearchTarget,
} from "./types";
import { searchEmbeddings } from "./embeddings-bin";

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

export interface FusedResult {
  id: string;
  score: number;
  sources: Array<"keyword" | "vector">;
}

export function reciprocalRankFusion(
  keywordResults: Array<{ id: string }>,
  vectorResults: VectorResult[],
  k: number = 60,
): FusedResult[] {
  const scores = new Map<
    string,
    { score: number; sources: Set<"keyword" | "vector"> }
  >();

  for (let i = 0; i < keywordResults.length; i++) {
    const id = keywordResults[i].id;
    const entry = scores.get(id) ?? { score: 0, sources: new Set() };
    entry.score += 1 / (k + i + 1);
    entry.sources.add("keyword");
    scores.set(id, entry);
  }

  for (let i = 0; i < vectorResults.length; i++) {
    const id = vectorResults[i].id;
    const entry = scores.get(id) ?? { score: 0, sources: new Set() };
    entry.score += 1 / (k + i + 1);
    entry.sources.add("vector");
    scores.set(id, entry);
  }

  return Array.from(scores.entries())
    .map(([id, { score, sources }]) => ({
      id,
      score,
      sources: Array.from(sources),
    }))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Hybrid Search
// ---------------------------------------------------------------------------

export function hybridSearch(
  store: MemoryStore,
  query: ExpandedQuery,
  embeddingIndex: BinEmbeddingIndex | null,
  queryVector: Float32Array | null,
  opts?: {
    limit?: number;
    target?: SearchTarget;
  },
): RankedResult[] {
  const limit = opts?.limit ?? 10;
  const target = opts?.target ?? "all";
  const fetchLimit = limit * 2;

  // 1. FTS5 keyword search
  const keywordSessions: Array<{ id: string; rank: number }> =
    target !== "events"
      ? store.searchSessionsFTS(query.terms.join(" "), fetchLimit)
      : [];

  const keywordEvents =
    target !== "sessions"
      ? store.searchEventsFTS(
          query.terms.join(" OR "),
          query.timeframe,
          fetchLimit,
        )
      : [];

  // 2. Vector search (sessions only — embeddings are keyed by session ID)
  const vectorResults: VectorResult[] =
    embeddingIndex && queryVector && target !== "events"
      ? searchEmbeddings(embeddingIndex, queryVector, fetchLimit)
      : [];

  // 3. Fuse session results via RRF
  const fusedSessions = reciprocalRankFusion(keywordSessions, vectorResults);

  // 4. Build ranked results
  const results: RankedResult[] = [];

  for (const fused of fusedSessions) {
    const session = store.getSession(fused.id);
    if (!session) continue;
    results.push({
      id: fused.id,
      type: "session",
      score: fused.score,
      sources: fused.sources,
      summary: session.summary,
      date: session.date,
    });
  }

  // Events don't go through RRF — they're ranked by FTS5 BM25 directly
  for (const event of keywordEvents) {
    results.push({
      id: String(event.rowid),
      type: "event",
      score: event.rank ? 1 / (60 + event.rank) : 0,
      sources: ["keyword"],
      date: event.date,
      subject: event.subject,
      action: event.action,
      object: event.object,
    });
  }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
