import { describe, test, expect } from "bun:test";
import { formatSearchResults } from "../../src/commands/search";
import type { RankedResult } from "../../src/lib/types";

describe("formatSearchResults", () => {
  test("returns no results message when empty", () => {
    const output = formatSearchResults([], "keyword (FTS5)");
    expect(output).toBe("No results found.");
  });

  test("shows provider name in header", () => {
    const results: RankedResult[] = [
      { id: "s1", type: "session", score: 0.5, sources: ["keyword"], summary: "test" },
    ];
    const output = formatSearchResults(results, "hybrid (keyword + vector)");
    expect(output).toContain("hybrid (keyword + vector)");
  });

  test("shows source tags for hybrid results", () => {
    const results: RankedResult[] = [
      {
        id: "s-auth",
        type: "session",
        score: 0.5,
        sources: ["keyword", "vector"],
        summary: "Implemented JWT auth",
      },
    ];
    const output = formatSearchResults(results, "hybrid (keyword + vector)");
    expect(output).toContain("[keyword+vector]");
    expect(output).toContain("s-auth");
    expect(output).toContain("JWT auth");
  });

  test("shows single source tag", () => {
    const results: RankedResult[] = [
      { id: "s1", type: "session", score: 0.3, sources: ["vector"], summary: "test" },
    ];
    const output = formatSearchResults(results, "hybrid (keyword + vector)");
    expect(output).toContain("[vector]");
  });

  test("formats event results with SVO", () => {
    const results: RankedResult[] = [
      {
        id: "42",
        type: "event",
        score: 0.3,
        sources: ["keyword"],
        subject: "user table",
        action: "migrated",
        object: "schema",
        date: "2026-03-28",
      },
    ];
    const output = formatSearchResults(results, "keyword (FTS5)");
    expect(output).toContain("user table migrated schema");
    expect(output).toContain("2026-03-28");
  });
});
