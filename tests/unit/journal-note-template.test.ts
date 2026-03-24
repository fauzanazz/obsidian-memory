import { describe, test, expect } from "bun:test";
import { journalNote } from "../../src/templates/note-templates";

describe("journalNote template", () => {
  const base = {
    project: "test-app",
    period: "2026-01",
    themes: ["Authentication", "API design", "Testing"],
    accomplishments: "Built the core auth system and REST API.",
    decisionsSummary: "Chose JWT for auth, PostgreSQL for storage.",
    patternsObserved: "TDD with integration tests for all endpoints.",
    outstandingBlockers: [] as string[],
    weeklyBreakdown: [
      { week: "Week of 2026-01-06", highlights: ["Set up project", "Added JWT auth"] },
      { week: "Week of 2026-01-13", highlights: ["Built REST API"] },
    ],
    sessionsArchived: 5,
  };

  test("produces valid YAML frontmatter with method: distillation", () => {
    const result = journalNote(base);
    expect(result).toContain("type: journal");
    expect(result).toContain("project: test-app");
    expect(result).toContain("period: 2026-01");
    expect(result).toContain("method: distillation");
    expect(result).toMatch(/created: \d{4}-\d{2}-\d{2}/);
    expect(result).toContain("  - journal");
    expect(result).toContain("  - project/test-app");
  });

  test("renders themes as bullet list", () => {
    const result = journalNote(base);
    expect(result).toContain("## Themes");
    expect(result).toContain("- Authentication");
    expect(result).toContain("- API design");
    expect(result).toContain("- Testing");
  });

  test("renders accomplishments", () => {
    const result = journalNote(base);
    expect(result).toContain("## Accomplishments");
    expect(result).toContain("Built the core auth system and REST API.");
  });

  test("renders weekly breakdown with highlights", () => {
    const result = journalNote(base);
    expect(result).toContain("## Weekly Breakdown");
    expect(result).toContain("### Week of 2026-01-06");
    expect(result).toContain("- Set up project");
    expect(result).toContain("### Week of 2026-01-13");
    expect(result).toContain("- Built REST API");
  });

  test("renders decisions summary and patterns", () => {
    const result = journalNote(base);
    expect(result).toContain("## Decisions Summary");
    expect(result).toContain("Chose JWT for auth");
    expect(result).toContain("## Patterns & Conventions");
    expect(result).toContain("TDD with integration tests");
  });

  test("renders outstanding blockers when present", () => {
    const result = journalNote({ ...base, outstandingBlockers: ["Rate limiting", "Missing docs"] });
    expect(result).toContain("## Outstanding Blockers");
    expect(result).toContain("- Rate limiting");
    expect(result).toContain("- Missing docs");
  });

  test("omits blockers section when empty", () => {
    const result = journalNote(base);
    expect(result).not.toContain("## Outstanding Blockers");
  });

  test("renders distillation count", () => {
    const result = journalNote(base);
    expect(result).toContain("> Distilled from 5 session(s).");
  });

  test("renders title with period and project", () => {
    const result = journalNote(base);
    expect(result).toContain("# Journal — 2026-01 — test-app");
  });
});
