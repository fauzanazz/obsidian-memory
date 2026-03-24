import { join } from "path";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingEntry {
  path: string;
  embedding: number[];
  content_hash: string;
  updated_at: string;
}

export interface EmbeddingIndex {
  version: number;
  model: string;
  dimension: number;
  entries: EmbeddingEntry[];
}

export interface VectorSearchResult {
  path: string;
  score: number;
}

export interface FusedSearchResult {
  path: string;
  score: number;
  sources: Array<"vector" | "keyword">;
}

export interface NoteContent {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMENSION = 768;
const INDEX_VERSION = 1;
const INDEX_DIR = "Memory/.embeddings";
const INDEX_FILENAME = `${INDEX_DIR}/index.json`;
const BATCH_SIZE = 20;

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Gemini Embedding API
// ---------------------------------------------------------------------------

export async function embedTexts(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!apiKey) return [];

  const results: number[][] = [];

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

    const data = (await response.json()) as {
      embeddings: Array<{ values: number[] }>;
    };

    for (const emb of data.embeddings) {
      results.push(emb.values);
    }
  }

  return results;
}

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

  const data = (await response.json()) as {
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

function emptyIndex(): EmbeddingIndex {
  return {
    version: INDEX_VERSION,
    model: EMBEDDING_MODEL,
    dimension: EMBEDDING_DIMENSION,
    entries: [],
  };
}

export async function loadIndex(vaultPath: string): Promise<EmbeddingIndex> {
  const indexPath = getIndexPath(vaultPath);
  const file = Bun.file(indexPath);

  if (!(await file.exists())) {
    return emptyIndex();
  }

  let data: EmbeddingIndex;
  try {
    data = (await file.json()) as EmbeddingIndex;
  } catch {
    return emptyIndex();
  }

  if (data.version !== INDEX_VERSION) {
    return emptyIndex();
  }

  return data;
}

export async function saveIndex(
  vaultPath: string,
  index: EmbeddingIndex,
): Promise<void> {
  const indexPath = getIndexPath(vaultPath);
  const dir = join(vaultPath, INDEX_DIR);

  // Ensure directory exists by writing a marker file
  await Bun.write(join(dir, ".gitkeep"), "");
  await Bun.write(indexPath, JSON.stringify(index));
}

// ---------------------------------------------------------------------------
// Index update (embed new/changed notes, remove deleted ones)
// ---------------------------------------------------------------------------

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

  const embeddings = await embedTexts(
    toEmbed.map((n) => n.content),
    apiKey,
  );

  const now = new Date().toISOString();

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

export async function addToIndex(
  vaultPath: string,
  note: NoteContent,
  apiKey: string,
): Promise<void> {
  if (!apiKey) return;

  const index = await loadIndex(vaultPath);
  const hash = hashContent(note.content);

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
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

export function reciprocalRankFusion(
  keywordResults: string[],
  vectorResults: VectorSearchResult[],
  k: number = 60,
): FusedSearchResult[] {
  const scores = new Map<
    string,
    { score: number; sources: Set<"vector" | "keyword"> }
  >();

  for (let i = 0; i < keywordResults.length; i++) {
    const path = keywordResults[i];
    const entry = scores.get(path) ?? { score: 0, sources: new Set() };
    entry.score += 1 / (k + i + 1);
    entry.sources.add("keyword");
    scores.set(path, entry);
  }

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

export function detectHybridSearch(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
