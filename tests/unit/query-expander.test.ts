import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { expandQuery } from "../../src/lib/query-expander";

describe("expandQuery", () => {
  // Ensure no real LLM env vars leak into tests
  let savedGeminiKey: string | undefined;

  beforeEach(() => {
    savedGeminiKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (savedGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = savedGeminiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("without API key: splits on whitespace", async () => {
    const result = await expandQuery("JWT authentication flow");
    expect(result.terms).toEqual(["JWT", "authentication", "flow"]);
    expect(result.original).toBe("JWT authentication flow");
    expect(result.timeframe).toBeUndefined();
  });

  test("without API key: filters empty terms", async () => {
    const result = await expandQuery("  spaced  out  query  ");
    expect(result.terms).toEqual(["spaced", "out", "query"]);
  });

  test("without API key: handles single word", async () => {
    const result = await expandQuery("auth");
    expect(result.terms).toEqual(["auth"]);
  });

  test("without API key: handles empty string", async () => {
    const result = await expandQuery("");
    expect(result.terms).toEqual([]);
  });

  test("preserves original query in all cases", async () => {
    const result = await expandQuery("test query", undefined);
    expect(result.original).toBe("test query");
  });

  // Mock fetch so the test never hits a real network endpoint.
  test("with invalid API key: falls back to raw terms", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as unknown as typeof fetch;
    try {
      const result = await expandQuery("auth flow", "invalid-key");
      // Should fall back to raw terms on error
      expect(result.terms).toEqual(["auth", "flow"]);
      expect(result.original).toBe("auth flow");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
