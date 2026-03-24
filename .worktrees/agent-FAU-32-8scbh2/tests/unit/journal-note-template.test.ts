import { describe, test, expect } from "bun:test";
import { journalNote, type JournalNoteOptions } from "../../src/templates/note-templates";

function makeOptions(overrides?: Partial<JournalNoteOptions>): JournalNoteOptions {
  return {
    project: "test-app",
    period: "2026-02",
    themes: ["CLI development", "Testing"],
    accomplishments: "Built the core CLI and test infrastructure.",
    decisionsSummary: "Chose Bun runtime. Used Obsidian CLI for vault operations.",
    patternsObserved: "Frontmatter-first approach for all notes.",
    outstandingBlockers: [],
    weeklyBreakdown: [
      {
        week: "Week of 2026-02-03",
        highlights: ["Implemented session saving", "Added search"],
      },
      {
        week: "Week of 2026-02-10",
        highlights: ["Built load-context"],
      },
    ],
    sessionsArchived: 5,
    ...overrides,
  };
}

describe("journalNote", () => {
  test("produces valid YAML frontmatter with method: distillation", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("---");
    expect(result).toContain("type: journal");
    expect(result).toContain("method: distillation");
    expect(result).toContain("project: test-app");
    expect(result).toContain("period: 2026-02");

    // Verify frontmatter is properly closed
    const parts = result.split("---");
    expect(parts.length).toBeGreaterThanOrEqual(3); // before, frontmatter, after
  });

  test("renders themes as bullet list", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("## Themes");
    expect(result).toContain("- CLI development");
    expect(result).toContain("- Testing");
  });

  test("renders accomplishments section", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("## Accomplishments");
    expect(result).toContain("Built the core CLI and test infrastructure.");
  });

  test("renders weekly breakdown with nested highlights", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("## Weekly Breakdown");
    expect(result).toContain("### Week of 2026-02-03");
    expect(result).toContain("- Implemented session saving");
    expect(result).toContain("- Added search");
    expect(result).toContain("### Week of 2026-02-10");
    expect(result).toContain("- Built load-context");
  });

  test("renders decisions summary section", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("## Decisions Summary");
    expect(result).toContain("Chose Bun runtime.");
  });

  test("renders patterns section", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("## Patterns & Conventions");
    expect(result).toContain("Frontmatter-first approach");
  });

  test("renders outstanding blockers when present", () => {
    const result = journalNote(
      makeOptions({
        outstandingBlockers: ["API rate limits", "Missing batch operations"],
      })
    );
    expect(result).toContain("## Outstanding Blockers");
    expect(result).toContain("- API rate limits");
    expect(result).toContain("- Missing batch operations");
  });

  test("omits blockers section when empty", () => {
    const result = journalNote(makeOptions({ outstandingBlockers: [] }));
    expect(result).not.toContain("## Outstanding Blockers");
  });

  test("includes session count in distillation note", () => {
    const result = journalNote(makeOptions({ sessionsArchived: 12 }));
    expect(result).toContain("Distilled from 12 session(s).");
  });

  test("renders correct title with period and project", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("# Journal — 2026-02 — test-app");
  });

  test("includes journal and project tags", () => {
    const result = journalNote(makeOptions());
    expect(result).toContain("  - journal");
    expect(result).toContain("  - project/test-app");
  });
});
