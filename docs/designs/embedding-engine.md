# Built-in Embedding Engine

## Context

obsidian-memory's search is keyword-only by default. The optional `obsidian-hybrid-search` binary adds semantic search but requires a separate install that most users don't have. This task creates a built-in embedding engine that generates, stores, and queries vector embeddings using Gemini's `text-embedding-004` model — the same API key already used for the enricher and distiller.

This module is a foundational library used by the hybrid search upgrade (next wave) and task-aware context loading (wave after). It has no CLI-facing changes — it's pure infrastructure.

## Requirements

- Generate 768-dimensional embeddings via Gemini `text-embedding-004` REST API
- Store embeddings in a JSON file at `Memory/.embeddings/index.json` inside the vault
- Content-hash-based cache: only re-embed notes whose content has changed
- Cosine similarity search: given a query embedding, return top-K results ranked by similarity
- Reciprocal rank fusion: merge vector results with keyword results into a single ranked list
- Batch embedding support: embed multiple texts in one API call (Gemini supports batch)
- Graceful degradation: all functions return empty/null when GEMINI_API_KEY is missing
- No new npm dependencies — use `fetch` directly (matching `llm.ts` pattern)

## Implementation

### 1. Create embedding engine module

**File:** `src/lib/embeddings.ts` (new)

```typescript
import { join } from "path";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingEntry {
  path: string;            // vault-relative path to the note
  embedding: number[];     // 768-dim vector
  content_hash: string;    // sha256 of the note content at embed time
  updated_at: string;      // ISO 8601
}

export interface EmbeddingIndex {
  version: number;         // schema version (1)
  model: string;           // "text-embedding-004"
  dimension: number;       // 768
  entries: EmbeddingEntry[];
}

export interface VectorSearchResult {
  path: string;
  score: number;           // cosine similarity, 0-1
}

export interface FusedSearchResult {
  path: string;
  score: number;           // fused score
  sources: Array<"vector" | "keyword">;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMENSION = 768;
const INDEX_VERSION = 1;
const INDEX_FILENAME = "Memory/.embeddings/index.json";
const BATCH_SIZE = 20; // Gemini supports up to 100, but 20 keeps requests small

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Gemini Embedding API
// ---------------------------------------------------------------------------

/**
 * Embed one or more texts using Gemini text-embedding-004.
 * Returns an array of embedding vectors (768 dimensions each).
 * Returns empty array when API key is missing (graceful degradation).
 */
export async function embedTexts(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!apiKey) return [];

  const results: number[][] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
        })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini embedding API error (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      embeddings: Array<{ values: number[] }>;
    };

    for (const emb of data.embeddings) {
      results.push(emb.values);
    }
  }

  return results;
}

/**
 * Embed a single query text (uses RETRIEVAL_QUERY task type for better relevance).
 * Returns empty array when API key is missing (graceful degradation).
 */
export async function embedQuery(
  text: string,
  apiKey: string,
): Promise<number[]> {
  if (!apiKey) return [];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_QUERY",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini embedding API error (${response.status}): ${err}`);
  }

  const data = await response.json() as {
    embedding: { values: number[] };
  };

  return data.embedding.values;
}

// ---------------------------------------------------------------------------
// Index persistence
// ---------------------------------------------------------------------------

export function getIndexPath(vaultPath: string): string {
  return join(vaultPath, INDEX_FILENAME);
}

export async function loadIndex(vaultPath: string): Promise<EmbeddingIndex> {
  const indexPath = getIndexPath(vaultPath);
  const file = Bun.file(indexPath);

  if (!(await file.exists())) {
    return {
      version: INDEX_VERSION,
      model: EMBEDDING_MODEL,
      dimension: EMBEDDING_DIMENSION,
      entries: [],
    };
  }

  const data = await file.json() as EmbeddingIndex;

  // Version check — if schema changed, start fresh
  if (data.version !== INDEX_VERSION) {
    return {
      version: INDEX_VERSION,
      model: EMBEDDING_MODEL,
      dimension: EMBEDDING_DIMENSION,
      entries: [],
    };
  }

  return data;
}

export async function saveIndex(
  vaultPath: string,
  index: EmbeddingIndex,
): Promise<void> {
  const indexPath = getIndexPath(vaultPath);
  const dir = join(vaultPath, "Memory", ".embeddings");

  // Ensure directory exists
  await Bun.write(join(dir, ".gitkeep"), ""); // creates dir
  await Bun.write(indexPath, JSON.stringify(index));
}

// ---------------------------------------------------------------------------
// Index update (embed new/changed notes, remove deleted ones)
// ---------------------------------------------------------------------------

export interface NoteContent {
  path: string;
  content: string;
}

/**
 * Update the embedding index with new/changed notes.
 * Returns the number of notes embedded.
 * Always prunes deleted notes, even when API key is missing.
 */
export async function updateIndex(
  vaultPath: string,
  notes: NoteContent[],
  apiKey: string,
): Promise<number> {
  const index = await loadIndex(vaultPath);
  const existingMap = new Map(index.entries.map((e) => [e.path, e]));
  const validPaths = new Set(notes.map((n) => n.path));

  // Always prune deleted notes, even without an API key
  const pruned = index.entries.length;
  index.entries = index.entries.filter((e) => validPaths.has(e.path));
  const prunedCount = pruned - index.entries.length;

  // Without an API key we can only prune, not embed
  if (!apiKey) {
    if (prunedCount > 0) await saveIndex(vaultPath, index);
    return 0;
  }

  // Find notes that need (re-)embedding
  const toEmbed: NoteContent[] = [];

  for (const note of notes) {
    const hash = hashContent(note.content);
    const existing = existingMap.get(note.path);

    if (!existing || existing.content_hash !== hash) {
      toEmbed.push(note);
    }
  }

  if (toEmbed.length === 0) {
    if (prunedCount > 0) await saveIndex(vaultPath, index);
    return 0;
  }

  // Generate embeddings
  const embeddings = await embedTexts(
    toEmbed.map((n) => n.content),
    apiKey,
  );

  const now = new Date().toISOString();

  // Update index
  for (let i = 0; i < toEmbed.length; i++) {
    const note = toEmbed[i];
    const entry: EmbeddingEntry = {
      path: note.path,
      embedding: embeddings[i],
      content_hash: hashContent(note.content),
      updated_at: now,
    };

    existingMap.set(note.path, entry);
  }

  // Rebuild from map (already pruned above, but filter again for safety)
  index.entries = Array.from(existingMap.values()).filter((e) =>
    validPaths.has(e.path),
  );

  await saveIndex(vaultPath, index);
  return toEmbed.length;
}

/**
 * Add a single note to the index (for use during save-session).
 * More efficient than updateIndex for single-note additions.
 */
export async function addToIndex(
  vaultPath: string,
  note: NoteContent,
  apiKey: string,
): Promise<void> {
  if (!apiKey) return;

  const index = await loadIndex(vaultPath);
  const hash = hashContent(note.content);

  // Check if already up to date
  const existing = index.entries.find((e) => e.path === note.path);
  if (existing && existing.content_hash === hash) return;

  const [embedding] = await embedTexts([note.content], apiKey);

  const entry: EmbeddingEntry = {
    path: note.path,
    embedding,
    content_hash: hash,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const idx = index.entries.indexOf(existing);
    index.entries[idx] = entry;
  } else {
    index.entries.push(entry);
  }

  await saveIndex(vaultPath, index);
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Search the embedding index for the top-K most similar notes to a query.
 */
export async function vectorSearch(
  vaultPath: string,
  queryText: string,
  apiKey: string,
  topK: number = 10,
): Promise<VectorSearchResult[]> {
  if (!apiKey) return [];

  const index = await loadIndex(vaultPath);
  if (index.entries.length === 0) return [];

  const queryEmbedding = await embedQuery(queryText, apiKey);

  const scored = index.entries.map((entry) => ({
    path: entry.path,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (merge keyword + vector results)
// ---------------------------------------------------------------------------

/**
 * Fuse keyword search results and vector search results using
 * Reciprocal Rank Fusion (RRF). Returns a unified ranked list.
 *
 * RRF score = sum(1 / (k + rank)) across all result lists where the item appears.
 * k=60 is the standard constant from the RRF paper.
 */
export function reciprocalRankFusion(
  keywordResults: string[],      // paths, ordered by keyword relevance
  vectorResults: VectorSearchResult[], // paths + scores, ordered by similarity
  k: number = 60,
): FusedSearchResult[] {
  const scores = new Map<string, { score: number; sources: Set<"vector" | "keyword"> }>();

  // Score keyword results by rank
  for (let i = 0; i < keywordResults.length; i++) {
    const path = keywordResults[i];
    const entry = scores.get(path) ?? { score: 0, sources: new Set() };
    entry.score += 1 / (k + i + 1);
    entry.sources.add("keyword");
    scores.set(path, entry);
  }

  // Score vector results by rank
  for (let i = 0; i < vectorResults.length; i++) {
    const path = vectorResults[i].path;
    const entry = scores.get(path) ?? { score: 0, sources: new Set() };
    entry.score += 1 / (k + i + 1);
    entry.sources.add("vector");
    scores.set(path, entry);
  }

  return Array.from(scores.entries())
    .map(([path, { score, sources }]) => ({
      path,
      score,
      sources: Array.from(sources),
    }))
    .sort((a, b) => b.score - a.score);
}
```

## Testing Strategy

**File:** `tests/unit/embeddings.test.ts` (new)

Test all pure functions (no API calls):

```typescript
import { describe, test, expect } from "bun:test";
import { hashContent, cosineSimilarity, reciprocalRankFusion } from "../../src/lib/embeddings";

describe("hashContent", () => {
  test("produces consistent hashes", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
  });
  test("different content produces different hashes", () => {
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });
});

describe("cosineSimilarity", () => {
  test("identical vectors return 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });
  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });
  test("opposite vectors return -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });
});

describe("reciprocalRankFusion", () => {
  test("fuses keyword and vector results", () => {
    const fused = reciprocalRankFusion(
      ["a.md", "b.md", "c.md"],
      [{ path: "b.md", score: 0.9 }, { path: "d.md", score: 0.8 }],
    );
    expect(fused.length).toBe(4);
    // b.md appears in both lists — should rank highest
    expect(fused[0].path).toBe("b.md");
    expect(fused[0].sources).toContain("keyword");
    expect(fused[0].sources).toContain("vector");
  });

  test("handles empty keyword results", () => {
    const fused = reciprocalRankFusion(
      [],
      [{ path: "a.md", score: 0.9 }],
    );
    expect(fused.length).toBe(1);
    expect(fused[0].sources).toEqual(["vector"]);
  });

  test("handles empty vector results", () => {
    const fused = reciprocalRankFusion(["a.md"], []);
    expect(fused.length).toBe(1);
    expect(fused[0].sources).toEqual(["keyword"]);
  });
});
```

Also add tests for `loadIndex`/`saveIndex` using temp directories, and test `embedTexts`/`embedQuery` with mocked fetch.

**Commands:**
```bash
bun test
cd /Users/enjat/Github/obsidian-memory && bunx tsc --noEmit
```

## Out of Scope

- CLI command changes (this is a library module only)
- Upgrading the `search` command (next wave)
- Embedding events from the event index (next wave, after event extractor exists)
- Local/Ollama embedding providers (Gemini only for now)
- Incremental index rebuild command (manual re-embed by deleting index.json)
- Compression of embedding vectors (full float64 is fine for <10K notes)
