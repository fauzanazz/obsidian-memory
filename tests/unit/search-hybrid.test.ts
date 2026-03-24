import { describe, test, expect, afterEach } from "bun:test";
import {
  UnifiedHybridProvider,
  ObsidianSearchProvider,
  createSearchProvider,
} from "../../src/lib/search";
import { reciprocalRankFusion } from "../../src/lib/embeddings";
import type { ObsidianCLI, SearchResult } from "../../src/lib/obsidian-cli";

// Minimal mock CLI
function createMockCLI(
  results: SearchResult[] = [],
  shouldThrow = false,
): ObsidianCLI {
  return {
    vault: "TestVault",
    search: async () => {
      if (shouldThrow) throw new Error("CLI search failed");
      return results;
    },
  } as unknown as ObsidianCLI;
}

describe("reciprocalRankFusion", () => {
  test("combines keyword and vector results", () => {
    const keywordPaths = ["a.md", "b.md", "c.md"];
    const vectorResults = [
      { path: "b.md", score: 0.95 },
      { path: "d.md", score: 0.90 },
      { path: "a.md", score: 0.85 },
    ];

    const fused = reciprocalRankFusion(keywordPaths, vectorResults);

    // Both a.md and b.md should have sources from both
    const aResult = fused.find((r) => r.path === "a.md");
    const bResult = fused.find((r) => r.path === "b.md");
    const cResult = fused.find((r) => r.path === "c.md");
    const dResult = fused.find((r) => r.path === "d.md");

    expect(aResult?.sources).toContain("keyword");
    expect(aResult?.sources).toContain("vector");
    expect(bResult?.sources).toContain("keyword");
    expect(bResult?.sources).toContain("vector");
    expect(cResult?.sources).toEqual(["keyword"]);
    expect(dResult?.sources).toEqual(["vector"]);
  });

  test("items in both lists rank higher", () => {
    const keywordPaths = ["a.md", "unique-keyword.md"];
    const vectorResults = [
      { path: "unique-vector.md", score: 0.99 },
      { path: "a.md", score: 0.5 },
    ];

    const fused = reciprocalRankFusion(keywordPaths, vectorResults);

    // a.md appears in both lists so should have highest combined score
    expect(fused[0].path).toBe("a.md");
  });

  test("handles empty keyword list", () => {
    const vectorResults = [
      { path: "x.md", score: 0.9 },
      { path: "y.md", score: 0.8 },
    ];

    const fused = reciprocalRankFusion([], vectorResults);

    expect(fused).toHaveLength(2);
    expect(fused[0].sources).toEqual(["vector"]);
  });

  test("handles empty vector list", () => {
    const fused = reciprocalRankFusion(["a.md", "b.md"], []);

    expect(fused).toHaveLength(2);
    expect(fused[0].sources).toEqual(["keyword"]);
  });

  test("handles both empty", () => {
    const fused = reciprocalRankFusion([], []);
    expect(fused).toHaveLength(0);
  });
});

describe("UnifiedHybridProvider", () => {
  const originalEnv = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalEnv) {
      process.env.GEMINI_API_KEY = originalEnv;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("has correct name", () => {
    const cli = createMockCLI();
    const provider = new UnifiedHybridProvider(cli, "/vault", "test-key");
    expect(provider.name).toBe("hybrid (keyword + vector)");
  });

  test("returns keyword results when vector search returns empty (no index)", async () => {
    const keywordResults: SearchResult[] = [
      { path: "Memory/a.md", matches: ["match a"] },
      { path: "Memory/b.md", matches: ["match b"] },
    ];

    const cli = createMockCLI(keywordResults);

    // Use a nonexistent vault path — vectorSearch will return [] because no index exists
    const provider = new UnifiedHybridProvider(cli, "/nonexistent-vault-path", "fake-key");

    const results = await provider.search("test query");

    // Should get keyword results fused (vector side is empty so all are keyword-only)
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.path).toBeDefined();
      expect(r.sources).toContain("keyword");
    }
  });
});

describe("ObsidianSearchProvider", () => {
  test("delegates to CLI", async () => {
    const expected: SearchResult[] = [
      { path: "test.md", matches: ["hello"] },
    ];
    const cli = createMockCLI(expected);
    const provider = new ObsidianSearchProvider(cli);

    const results = await provider.search("hello");
    expect(results).toEqual(expected);
    expect(provider.name).toBe("obsidian-cli");
  });
});

describe("createSearchProvider", () => {
  const originalEnv = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalEnv) {
      process.env.GEMINI_API_KEY = originalEnv;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("returns ObsidianSearchProvider when no API key", async () => {
    delete process.env.GEMINI_API_KEY;
    const cli = createMockCLI();
    const provider = await createSearchProvider(cli);
    expect(provider.name).toBe("obsidian-cli");
  });

  test("returns ObsidianSearchProvider when no vault path", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const cli = createMockCLI();
    const provider = await createSearchProvider(cli);
    expect(provider.name).toBe("obsidian-cli");
  });

  test("returns UnifiedHybridProvider when API key and vault path present", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const cli = createMockCLI();
    const provider = await createSearchProvider(cli, "/vault");
    expect(provider.name).toBe("hybrid (keyword + vector)");
  });
});
