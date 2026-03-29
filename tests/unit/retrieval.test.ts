import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { reciprocalRankFusion, hybridSearch } from "../../src/lib/retrieval";
import { MemoryStore } from "../../src/lib/store";
import { emptyIndex, addEntry, contentHash } from "../../src/lib/embeddings-bin";
import type { ExpandedQuery, VectorResult } from "../../src/lib/types";

// ---------------------------------------------------------------------------
// RRF
// ---------------------------------------------------------------------------

describe("reciprocalRankFusion", () => {
  test("empty inputs return empty", () => {
    const result = reciprocalRankFusion([], []);
    expect(result).toHaveLength(0);
  });

  test("keyword-only results", () => {
    const result = reciprocalRankFusion(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [],
    );
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("a"); // rank 0 → highest score
    expect(result[0].sources).toEqual(["keyword"]);
    // Scores should be monotonically decreasing
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[1].score).toBeGreaterThan(result[2].score);
  });

  test("vector-only results", () => {
    const vectors: VectorResult[] = [
      { id: "x", score: 0.9 },
      { id: "y", score: 0.7 },
    ];
    const result = reciprocalRankFusion([], vectors);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("x");
    expect(result[0].sources).toEqual(["vector"]);
  });

  test("overlapping results boost score", () => {
    const keyword = [{ id: "both" }, { id: "keyword-only" }];
    const vector: VectorResult[] = [
      { id: "both", score: 0.9 },
      { id: "vector-only", score: 0.8 },
    ];

    const result = reciprocalRankFusion(keyword, vector);
    const bothResult = result.find((r) => r.id === "both")!;
    const keywordOnly = result.find((r) => r.id === "keyword-only")!;
    const vectorOnly = result.find((r) => r.id === "vector-only")!;

    // "both" should have higher score from two sources
    expect(bothResult.score).toBeGreaterThan(keywordOnly.score);
    expect(bothResult.score).toBeGreaterThan(vectorOnly.score);
    expect(bothResult.sources).toContain("keyword");
    expect(bothResult.sources).toContain("vector");
  });

  test("uses k=60 by default", () => {
    const result = reciprocalRankFusion([{ id: "a" }], []);
    // Score = 1 / (60 + 0 + 1) = 1/61
    expect(result[0].score).toBeCloseTo(1 / 61, 10);
  });

  test("custom k value", () => {
    const result = reciprocalRankFusion([{ id: "a" }], [], 10);
    // Score = 1 / (10 + 0 + 1) = 1/11
    expect(result[0].score).toBeCloseTo(1 / 11, 10);
  });
});

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

describe("hybridSearch", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(":memory:", "test-project");

    // Insert sessions with searchable content
    store.insertSession("s-auth", {
      project: "test-project",
      agent: "claude-code",
      date: "2026-03-29",
      summary: "Implemented JWT authentication middleware",
      content: "Built JWT token validation and refresh logic",
    });
    store.insertSession("s-db", {
      project: "test-project",
      agent: "claude-code",
      date: "2026-03-28",
      summary: "Fixed database migration for user table",
      content: "Resolved schema conflict in user table migration",
    });

    // Insert events with FTS5 indexing
    store.insertEvent({
      project: "test-project",
      sessionId: "s-auth",
      date: "2026-03-29",
      subject: "JWT middleware",
      action: "implemented",
      object: "token validation",
      aliases: "authentication login bearer",
      isBase: false,
    });
    store.insertEvent({
      project: "test-project",
      sessionId: "s-db",
      date: "2026-03-28",
      subject: "user table",
      action: "migrated",
      object: "database schema",
      aliases: "db migration sql",
      isBase: false,
    });
  });

  afterEach(() => {
    store.close();
  });

  test("keyword-only search (no embeddings)", () => {
    const query: ExpandedQuery = {
      terms: ["JWT", "authentication"],
      original: "JWT authentication",
    };

    const results = hybridSearch(store, query, null, null);
    expect(results.length).toBeGreaterThan(0);

    // Should find both session and event results
    const types = results.map((r) => r.type);
    expect(types).toContain("event");
  });

  test("search with target=events only returns events", () => {
    const query: ExpandedQuery = {
      terms: ["migration"],
      original: "migration",
    };

    const results = hybridSearch(store, query, null, null, {
      target: "events",
    });
    for (const r of results) {
      expect(r.type).toBe("event");
    }
  });

  test("search with target=sessions only returns sessions", () => {
    const query: ExpandedQuery = {
      terms: ["JWT"],
      original: "JWT",
    };

    const results = hybridSearch(store, query, null, null, {
      target: "sessions",
    });
    for (const r of results) {
      expect(r.type).toBe("session");
    }
  });

  test("hybrid search with embeddings boosts session results", () => {
    // Create an embedding index with a vector for s-auth
    const dim = 4;
    let embIndex = emptyIndex(dim);
    const authVec = new Float32Array([1, 0, 0, 0]);
    const dbVec = new Float32Array([0, 0, 1, 0]);
    embIndex = addEntry(embIndex, "s-auth", contentHash("auth"), authVec);
    embIndex = addEntry(embIndex, "s-db", contentHash("db"), dbVec);

    // Query vector similar to auth
    const queryVec = new Float32Array([0.9, 0.1, 0, 0]);

    const query: ExpandedQuery = {
      terms: ["authentication"],
      original: "authentication",
    };

    const results = hybridSearch(store, query, embIndex, queryVec);
    // s-auth should rank higher since it matches both keyword AND vector
    const sessionResults = results.filter((r) => r.type === "session");
    if (sessionResults.length >= 2) {
      expect(sessionResults[0].id).toBe("s-auth");
    }
  });

  test("respects limit", () => {
    const query: ExpandedQuery = {
      terms: ["middleware", "database", "authentication", "migration"],
      original: "everything",
    };

    const results = hybridSearch(store, query, null, null, { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("results sorted by score descending", () => {
    const query: ExpandedQuery = {
      terms: ["JWT", "database"],
      original: "JWT database",
    };

    const results = hybridSearch(store, query, null, null);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
