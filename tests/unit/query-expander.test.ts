import { describe, test, expect } from "bun:test";
import { expandQuery } from "../../src/lib/query-expander";

describe("expandQuery", () => {
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

  // LLM-dependent tests would require mocking fetch.
  // We test the graceful fallback path here.
  test("with invalid API key: falls back to raw terms", async () => {
    // This will attempt an LLM call which should fail, then fall back
    const result = await expandQuery("auth flow", "invalid-key");
    // Should fall back to raw terms on error
    expect(result.terms.length).toBeGreaterThan(0);
    expect(result.original).toBe("auth flow");
  });
});
