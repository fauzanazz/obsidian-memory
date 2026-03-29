import { describe, test, expect } from "bun:test";
import {
  writeEmbeddingsBin,
  readEmbeddingsBin,
  loadEmbeddingsFile,
  saveEmbeddingsFile,
  addEntry,
  removeEntry,
  emptyIndex,
  searchEmbeddings,
  cosineSimilarity,
  contentHash,
} from "../../src/lib/embeddings-bin";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.random() * 2 - 1;
  return v;
}

function normalizedVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed * (i + 1));
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

describe("contentHash", () => {
  test("produces 16-byte hash", () => {
    const hash = contentHash("hello world");
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.byteLength).toBe(16);
  });

  test("same input produces same hash", () => {
    const a = contentHash("test content");
    const b = contentHash("test content");
    expect(a).toEqual(b);
  });

  test("different inputs produce different hashes", () => {
    const a = contentHash("hello");
    const b = contentHash("world");
    expect(a).not.toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Write / Read round-trip
// ---------------------------------------------------------------------------

describe("writeEmbeddingsBin / readEmbeddingsBin", () => {
  test("empty index round-trips", () => {
    const bin = writeEmbeddingsBin([], 768);
    const index = readEmbeddingsBin(bin);

    expect(index.version).toBe(1);
    expect(index.count).toBe(0);
    expect(index.dimension).toBe(768);
    expect(index.entries.size).toBe(0);
  });

  test("single entry round-trips", () => {
    const dim = 4;
    const vector = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const hash = contentHash("test content");

    const bin = writeEmbeddingsBin(
      [{ key: "session-1", contentHash: hash, vector }],
      dim,
    );
    const index = readEmbeddingsBin(bin);

    expect(index.count).toBe(1);
    expect(index.dimension).toBe(dim);
    expect(index.entries.has("session-1")).toBe(true);
    expect(index.hashes.get("session-1")).toEqual(hash);

    const vecIdx = index.entries.get("session-1")!;
    const readVec = index.vectors.slice(vecIdx * dim, (vecIdx + 1) * dim);
    expect(Array.from(readVec)).toEqual([1.0, 2.0, 3.0, 4.0]);
  });

  test("multiple entries round-trip", () => {
    const dim = 3;
    const entries = [
      {
        key: "a",
        contentHash: contentHash("content a"),
        vector: new Float32Array([1, 0, 0]),
      },
      {
        key: "b",
        contentHash: contentHash("content b"),
        vector: new Float32Array([0, 1, 0]),
      },
      {
        key: "c",
        contentHash: contentHash("content c"),
        vector: new Float32Array([0, 0, 1]),
      },
    ];

    const bin = writeEmbeddingsBin(entries, dim);
    const index = readEmbeddingsBin(bin);

    expect(index.count).toBe(3);
    for (const entry of entries) {
      expect(index.entries.has(entry.key)).toBe(true);
      const i = index.entries.get(entry.key)!;
      const v = index.vectors.slice(i * dim, (i + 1) * dim);
      expect(Array.from(v)).toEqual(Array.from(entry.vector));
    }
  });

  test("handles unicode keys", () => {
    const dim = 2;
    const bin = writeEmbeddingsBin(
      [
        {
          key: "日本語-session",
          contentHash: contentHash("test"),
          vector: new Float32Array([1, 2]),
        },
      ],
      dim,
    );
    const index = readEmbeddingsBin(bin);
    expect(index.entries.has("日本語-session")).toBe(true);
  });

  test("throws on invalid data", () => {
    expect(() => readEmbeddingsBin(new Uint8Array(4))).toThrow();
  });

  test("throws on unsupported version", () => {
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    view.setUint32(0, 99, true); // bad version
    view.setUint32(4, 0, true);
    view.setUint32(8, 768, true);
    expect(() => readEmbeddingsBin(new Uint8Array(buf))).toThrow(
      /unsupported/i,
    );
  });
});

// ---------------------------------------------------------------------------
// File persistence
// ---------------------------------------------------------------------------

describe("loadEmbeddingsFile / saveEmbeddingsFile", () => {
  test("returns null for non-existent file", async () => {
    const result = await loadEmbeddingsFile("/nonexistent/path.bin");
    expect(result).toBeNull();
  });

  test("round-trips through file", async () => {
    const dim = 4;
    const tmpPath = join(tmpdir(), `test-embeddings-${Date.now()}.bin`);

    const index = emptyIndex(dim);
    const updated = addEntry(
      index,
      "s1",
      contentHash("hello"),
      new Float32Array([1, 2, 3, 4]),
    );

    await saveEmbeddingsFile(tmpPath, updated);
    const loaded = await loadEmbeddingsFile(tmpPath);

    expect(loaded).not.toBeNull();
    expect(loaded!.count).toBe(1);
    expect(loaded!.entries.has("s1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Add / Remove entries
// ---------------------------------------------------------------------------

describe("addEntry / removeEntry", () => {
  test("add to empty index", () => {
    const index = emptyIndex(3);
    const updated = addEntry(
      index,
      "s1",
      contentHash("content"),
      new Float32Array([1, 2, 3]),
    );

    expect(updated.count).toBe(1);
    expect(updated.entries.has("s1")).toBe(true);
  });

  test("update existing entry", () => {
    let index = emptyIndex(3);
    index = addEntry(index, "s1", contentHash("v1"), new Float32Array([1, 0, 0]));
    index = addEntry(index, "s1", contentHash("v2"), new Float32Array([0, 1, 0]));

    expect(index.count).toBe(1);
    const i = index.entries.get("s1")!;
    const v = index.vectors.slice(i * 3, (i + 1) * 3);
    expect(Array.from(v)).toEqual([0, 1, 0]);
  });

  test("remove entry", () => {
    let index = emptyIndex(3);
    index = addEntry(index, "s1", contentHash("a"), new Float32Array([1, 0, 0]));
    index = addEntry(index, "s2", contentHash("b"), new Float32Array([0, 1, 0]));

    index = removeEntry(index, "s1");
    expect(index.count).toBe(1);
    expect(index.entries.has("s1")).toBe(false);
    expect(index.entries.has("s2")).toBe(true);
  });

  test("remove non-existent entry is no-op", () => {
    const index = emptyIndex(3);
    const result = removeEntry(index, "nonexistent");
    expect(result.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  test("identical vectors = 1.0", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  test("orthogonal vectors = 0.0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  test("opposite vectors = -1.0", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  test("zero vector = 0.0", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe("searchEmbeddings", () => {
  test("returns empty for empty index", () => {
    const index = emptyIndex(3);
    const query = new Float32Array([1, 0, 0]);
    const results = searchEmbeddings(index, query, 5);
    expect(results).toHaveLength(0);
  });

  test("finds most similar vector", () => {
    const dim = 8;
    let index = emptyIndex(dim);

    // Create 3 vectors: target is most similar to query
    const query = normalizedVector(dim, 1.0);
    const similar = normalizedVector(dim, 1.1); // close to query
    const different = normalizedVector(dim, 50.0); // far from query

    index = addEntry(index, "similar", contentHash("a"), similar);
    index = addEntry(index, "different", contentHash("b"), different);

    const results = searchEmbeddings(index, query, 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("similar");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("respects topK limit", () => {
    const dim = 4;
    let index = emptyIndex(dim);

    for (let i = 0; i < 10; i++) {
      index = addEntry(
        index,
        `s${i}`,
        contentHash(`content-${i}`),
        randomVector(dim),
      );
    }

    const results = searchEmbeddings(index, randomVector(dim), 3);
    expect(results).toHaveLength(3);
  });

  test("results are sorted by score descending", () => {
    const dim = 4;
    let index = emptyIndex(dim);

    for (let i = 0; i < 5; i++) {
      index = addEntry(
        index,
        `s${i}`,
        contentHash(`c${i}`),
        randomVector(dim),
      );
    }

    const results = searchEmbeddings(index, randomVector(dim), 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
