import { describe, test, expect } from "bun:test";
import { formatSearchResults } from "../../src/commands/search";

describe("formatSearchResults", () => {
  test("returns no results message when empty", () => {
    const output = formatSearchResults([], "obsidian-cli");
    expect(output).toBe("No results found.");
  });

  test("shows provider name in header", () => {
    const results = [{ path: "test.md", matches: [] }];
    const output = formatSearchResults(results, "hybrid (keyword + vector)");
    expect(output).toContain("hybrid (keyword + vector)");
  });

  test("shows source tags for hybrid results", () => {
    const results = [
      {
        path: "Memory/a.md",
        matches: ["some match"],
        score: 0.5,
        sources: ["keyword", "vector"],
      },
    ] as any[];

    const output = formatSearchResults(results, "hybrid (keyword + vector)");
    expect(output).toContain("[keyword+vector]");
    expect(output).toContain("Memory/a.md");
  });

  test("shows single source tag", () => {
    const results = [
      {
        path: "Memory/b.md",
        matches: [],
        score: 0.3,
        sources: ["vector"],
      },
    ] as any[];

    const output = formatSearchResults(results, "hybrid (keyword + vector)");
    expect(output).toContain("[vector]");
  });

  test("shows no source tag for plain results", () => {
    const results = [{ path: "test.md", matches: ["hello world"] }];
    const output = formatSearchResults(results, "obsidian-cli");
    expect(output).toContain("  test.md");
    expect(output).not.toContain("[");
  });

  test("shows up to 2 matches per result", () => {
    const results = [
      {
        path: "test.md",
        matches: ["match 1", "match 2", "match 3"],
      },
    ];
    const output = formatSearchResults(results, "obsidian-cli");
    expect(output).toContain("match 1");
    expect(output).toContain("match 2");
    expect(output).not.toContain("match 3");
  });
});
