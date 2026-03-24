import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  hashContent,
  cosineSimilarity,
  reciprocalRankFusion,
  loadIndex,
  saveIndex,
  getIndexPath,
  embedTexts,
  embedQuery,
  updateIndex,
  addToIndex,
  vectorSearch,
  detectHybridSearch,
} from "../../src/lib/embeddings";

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

describe("hashContent", () => {
  test("produces consistent hashes", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
  });

  test("different content produces different hashes", () => {
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });

  test("returns 16-character hex string", () => {
    const hash = hashContent("test content");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
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

  test("handles zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  test("similar vectors return high score", () => {
    const score = cosineSimilarity([1, 2, 3], [1, 2, 4]);
    expect(score).toBeGreaterThan(0.9);
  });
});

describe("reciprocalRankFusion", () => {
  test("fuses keyword and vector results", () => {
    const fused = reciprocalRankFusion(
      ["a.md", "b.md", "c.md"],
      [
        { path: "b.md", score: 0.9 },
        { path: "d.md", score: 0.8 },
      ],
    );
    expect(fused.length).toBe(4);
    // b.md appears in both lists — should rank highest
    expect(fused[0].path).toBe("b.md");
    expect(fused[0].sources).toContain("keyword");
    expect(fused[0].sources).toContain("vector");
  });

  test("handles empty keyword results", () => {
    const fused = reciprocalRankFusion([], [{ path: "a.md", score: 0.9 }]);
    expect(fused.length).toBe(1);
    expect(fused[0].sources).toEqual(["vector"]);
  });

  test("handles empty vector results", () => {
    const fused = reciprocalRankFusion(["a.md"], []);
    expect(fused.length).toBe(1);
    expect(fused[0].sources).toEqual(["keyword"]);
  });

  test("handles both empty", () => {
    const fused = reciprocalRankFusion([], []);
    expect(fused.length).toBe(0);
  });

  test("respects custom k parameter", () => {
    const fused = reciprocalRankFusion(
      ["a.md"],
      [{ path: "a.md", score: 0.9 }],
      10,
    );
    // With k=10, score = 1/(10+1) + 1/(10+1) = 2/11
    expect(fused[0].score).toBeCloseTo(2 / 11);
  });
});

// ---------------------------------------------------------------------------
// Index persistence
// ---------------------------------------------------------------------------

describe("index persistence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "embed-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("getIndexPath returns correct path", () => {
    expect(getIndexPath("/vault")).toBe(
      join("/vault", "Memory/.embeddings/index.json"),
    );
  });

  test("loadIndex returns empty index when file missing", async () => {
    const index = await loadIndex(tempDir);
    expect(index.version).toBe(1);
    expect(index.model).toBe("text-embedding-004");
    expect(index.dimension).toBe(768);
    expect(index.entries).toEqual([]);
  });

  test("saveIndex and loadIndex round-trip", async () => {
    const index = {
      version: 1,
      model: "text-embedding-004",
      dimension: 768,
      entries: [
        {
          path: "note.md",
          embedding: [0.1, 0.2, 0.3],
          content_hash: "abc123",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    await saveIndex(tempDir, index);
    const loaded = await loadIndex(tempDir);

    expect(loaded.version).toBe(1);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].path).toBe("note.md");
    expect(loaded.entries[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test("loadIndex resets on version mismatch", async () => {
    const oldIndex = {
      version: 999,
      model: "old-model",
      dimension: 512,
      entries: [
        {
          path: "old.md",
          embedding: [1],
          content_hash: "x",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    const indexPath = getIndexPath(tempDir);
    const dir = join(tempDir, "Memory/.embeddings");
    await Bun.write(join(dir, ".gitkeep"), "");
    await Bun.write(indexPath, JSON.stringify(oldIndex));

    const loaded = await loadIndex(tempDir);
    expect(loaded.entries).toEqual([]);
    expect(loaded.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("embedTexts", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns empty array for empty input", async () => {
    const result = await embedTexts([], "test-key");
    expect(result).toEqual([]);
  });

  test("returns empty array when API key is missing", async () => {
    const result = await embedTexts(["hello"], "");
    expect(result).toEqual([]);
  });

  test("calls Gemini batch API with x-goog-api-key header", async () => {
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      expect(urlStr).not.toContain("key=");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("test-key");

      const body = JSON.parse(init?.body as string);
      expect(body.requests).toHaveLength(2);
      expect(body.requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
      expect(body.requests[0].model).toBe("models/text-embedding-004");

      return new Response(
        JSON.stringify({
          embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
        }),
        { status: 200 },
      );
    };

    const result = await embedTexts(["hello", "world"], "test-key");
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  test("batches large inputs", async () => {
    let callCount = 0;

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const body = JSON.parse(init?.body as string);
      const embeddings = body.requests.map((_: unknown, i: number) => ({
        values: [callCount, i],
      }));
      return new Response(JSON.stringify({ embeddings }), { status: 200 });
    };

    // 25 texts should result in 2 API calls (batch size = 20)
    const texts = Array.from({ length: 25 }, (_, i) => `text-${i}`);
    const result = await embedTexts(texts, "test-key");

    expect(callCount).toBe(2);
    expect(result).toHaveLength(25);
  });

  test("throws on API error", async () => {
    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401 });

    await expect(embedTexts(["hello"], "bad-key")).rejects.toThrow(
      "Gemini embedding API error (401)",
    );
  });
});

describe("embedQuery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns empty array when API key is missing", async () => {
    const result = await embedQuery("hello", "");
    expect(result).toEqual([]);
  });

  test("calls Gemini single embed API with x-goog-api-key header", async () => {
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const urlStr = _url.toString();
      expect(urlStr).not.toContain("key=");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("test-key");

      const body = JSON.parse(init?.body as string);
      expect(body.taskType).toBe("RETRIEVAL_QUERY");
      expect(body.model).toBe("models/text-embedding-004");

      return new Response(
        JSON.stringify({ embedding: { values: [0.5, 0.6, 0.7] } }),
        { status: 200 },
      );
    };

    const result = await embedQuery("search query", "test-key");
    expect(result).toEqual([0.5, 0.6, 0.7]);
  });

  test("throws on API error", async () => {
    globalThis.fetch = async () =>
      new Response("Rate limited", { status: 429 });

    await expect(embedQuery("hello", "test-key")).rejects.toThrow(
      "Gemini embedding API error (429)",
    );
  });
});

// ---------------------------------------------------------------------------
// Index update (mocked API)
// ---------------------------------------------------------------------------

describe("updateIndex", () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "embed-update-"));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true });
  });

  function mockEmbedAPI() {
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      const embeddings = body.requests.map((_: unknown, i: number) => ({
        values: Array(3).fill(i * 0.1),
      }));
      return new Response(JSON.stringify({ embeddings }), { status: 200 });
    };
  }

  test("returns 0 when API key is missing", async () => {
    const count = await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello" }],
      "",
    );
    expect(count).toBe(0);
  });

  test("embeds new notes and returns count", async () => {
    mockEmbedAPI();

    const count = await updateIndex(
      tempDir,
      [
        { path: "a.md", content: "hello" },
        { path: "b.md", content: "world" },
      ],
      "test-key",
    );

    expect(count).toBe(2);

    const index = await loadIndex(tempDir);
    expect(index.entries).toHaveLength(2);
  });

  test("skips unchanged notes", async () => {
    mockEmbedAPI();

    // First update
    await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello" }],
      "test-key",
    );

    // Second update with same content
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(
        JSON.stringify({ embeddings: [{ values: [0] }] }),
        { status: 200 },
      );
    };

    const count = await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello" }],
      "test-key",
    );

    expect(count).toBe(0);
    expect(fetchCalled).toBe(false);
  });

  test("re-embeds changed notes", async () => {
    mockEmbedAPI();

    await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello" }],
      "test-key",
    );

    mockEmbedAPI();

    const count = await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello updated" }],
      "test-key",
    );

    expect(count).toBe(1);
  });

  test("prunes deleted notes", async () => {
    mockEmbedAPI();

    await updateIndex(
      tempDir,
      [
        { path: "a.md", content: "hello" },
        { path: "b.md", content: "world" },
      ],
      "test-key",
    );

    // Only pass a.md — b.md should be pruned
    const count = await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello" }],
      "test-key",
    );

    expect(count).toBe(0);
    const index = await loadIndex(tempDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].path).toBe("a.md");
  });

  test("prunes deleted notes even when API key is missing", async () => {
    mockEmbedAPI();

    await updateIndex(
      tempDir,
      [
        { path: "a.md", content: "hello" },
        { path: "b.md", content: "world" },
      ],
      "test-key",
    );

    // Prune with no API key — b.md should still be removed
    const count = await updateIndex(
      tempDir,
      [{ path: "a.md", content: "hello" }],
      "",
    );

    expect(count).toBe(0);
    const index = await loadIndex(tempDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].path).toBe("a.md");
  });
});

describe("addToIndex", () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "embed-add-"));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true });
  });

  function mockSingleEmbed() {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }),
        { status: 200 },
      );
  }

  test("returns without error when API key is missing", async () => {
    await addToIndex(tempDir, { path: "a.md", content: "hello" }, "");
    const index = await loadIndex(tempDir);
    expect(index.entries).toHaveLength(0);
  });

  test("adds new note to empty index", async () => {
    mockSingleEmbed();

    await addToIndex(tempDir, { path: "new.md", content: "fresh" }, "test-key");

    const index = await loadIndex(tempDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].path).toBe("new.md");
  });

  test("skips if content unchanged", async () => {
    mockSingleEmbed();

    await addToIndex(tempDir, { path: "a.md", content: "hello" }, "test-key");

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(
        JSON.stringify({ embeddings: [{ values: [0] }] }),
        { status: 200 },
      );
    };

    await addToIndex(tempDir, { path: "a.md", content: "hello" }, "test-key");
    expect(fetchCalled).toBe(false);
  });

  test("updates existing note with new content", async () => {
    mockSingleEmbed();

    await addToIndex(tempDir, { path: "a.md", content: "v1" }, "test-key");

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ embeddings: [{ values: [0.9, 0.8, 0.7] }] }),
        { status: 200 },
      );

    await addToIndex(tempDir, { path: "a.md", content: "v2" }, "test-key");

    const index = await loadIndex(tempDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].embedding).toEqual([0.9, 0.8, 0.7]);
  });
});

// ---------------------------------------------------------------------------
// Vector search (mocked API)
// ---------------------------------------------------------------------------

describe("vectorSearch", () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "embed-search-"));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true });
  });

  test("returns empty when API key is missing", async () => {
    const results = await vectorSearch(tempDir, "query", "");
    expect(results).toEqual([]);
  });

  test("returns empty for empty index", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ embedding: { values: [1, 0, 0] } }),
        { status: 200 },
      );

    const results = await vectorSearch(tempDir, "query", "test-key");
    expect(results).toEqual([]);
  });

  test("returns ranked results", async () => {
    // Seed index with entries
    const index = {
      version: 1,
      model: "text-embedding-004",
      dimension: 3,
      entries: [
        {
          path: "close.md",
          embedding: [0.9, 0.1, 0.0],
          content_hash: "aaa",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
        {
          path: "far.md",
          embedding: [0.0, 0.0, 1.0],
          content_hash: "bbb",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    await saveIndex(tempDir, index);

    // Mock query embedding close to [1, 0, 0]
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ embedding: { values: [1.0, 0.0, 0.0] } }),
        { status: 200 },
      );

    const results = await vectorSearch(tempDir, "query", "test-key", 2);
    expect(results).toHaveLength(2);
    expect(results[0].path).toBe("close.md");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("respects topK limit", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      path: `note-${i}.md`,
      embedding: [i * 0.1, 0, 0],
      content_hash: `hash${i}`,
      updated_at: "2025-01-01T00:00:00.000Z",
    }));

    await saveIndex(tempDir, {
      version: 1,
      model: "text-embedding-004",
      dimension: 3,
      entries,
    });

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ embedding: { values: [1, 0, 0] } }),
        { status: 200 },
      );

    const results = await vectorSearch(tempDir, "query", "test-key", 3);
    expect(results).toHaveLength(3);
  });
});

describe("detectHybridSearch", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalKey) {
      process.env.GEMINI_API_KEY = originalKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("returns true when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "test-key";
    expect(detectHybridSearch()).toBe(true);
  });

  test("returns false when GEMINI_API_KEY is not set", () => {
    delete process.env.GEMINI_API_KEY;
    expect(detectHybridSearch()).toBe(false);
  });
});
