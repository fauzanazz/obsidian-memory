import { describe, test, expect } from "bun:test";
import { adrNote, type ADRNoteOptions } from "../../src/templates/note-templates";

function makeOptions(overrides: Partial<ADRNoteOptions> = {}): ADRNoteOptions {
  return {
    project: "test-app",
    adrNumber: 3,
    title: "JWT Authentication over Session Cookies",
    date: "2026-03-21",
    status: "accepted",
    context: "Need auth for the API",
    decision: "Use JWT in httpOnly cookies",
    ...overrides,
  };
}

describe("adrNote template", () => {
  test("produces valid YAML frontmatter with all required fields", () => {
    const result = adrNote(makeOptions());

    expect(result).toMatch(/^---\n/);
    expect(result).toContain("type: adr");
    expect(result).toContain("project: test-app");
    expect(result).toContain("adr: 3");
    expect(result).toContain("title: JWT Authentication over Session Cookies");
    expect(result).toContain("created: 2026-03-21");
    expect(result).toContain("updated: 2026-03-21");
    expect(result).toContain("status: accepted");
    expect(result).toContain("supersedes: null");
    expect(result).toContain("superseded_by: null");
    expect(result).toContain("  - adr");
    expect(result).toContain("  - project/test-app");
  });

  test("renders alternatives as ### subsections", () => {
    const result = adrNote(
      makeOptions({
        alternatives: [
          { name: "Session Cookies", proscons: "Simple but requires Redis" },
          { name: "OAuth2 only", proscons: "Standard but overkill for internal API" },
        ],
      })
    );

    expect(result).toContain("## Alternatives Considered");
    expect(result).toContain("### Session Cookies");
    expect(result).toContain("Simple but requires Redis");
    expect(result).toContain("### OAuth2 only");
    expect(result).toContain("Standard but overkill for internal API");
  });

  test("with supersedes includes wikilink to superseded ADR", () => {
    const result = adrNote(
      makeOptions({
        adrNumber: 5,
        supersedes: 2,
      })
    );

    expect(result).toContain("## Status — accepted (supersedes [[ADR-002]])");
  });

  test("with supersededBy includes wikilink to superseding ADR", () => {
    const result = adrNote(
      makeOptions({
        status: "superseded",
        supersededBy: 7,
      })
    );

    expect(result).toContain("## Status — superseded (superseded by [[ADR-007]])");
  });

  test("with minimal options (only required) produces valid note", () => {
    const result = adrNote(
      makeOptions({
        alternatives: undefined,
        consequences: undefined,
      })
    );

    expect(result).toContain("# ADR-003: JWT Authentication over Session Cookies");
    expect(result).toContain("## Context");
    expect(result).toContain("## Decision");
    expect(result).toContain("## Alternatives Considered");
    expect(result).toContain("<!-- No alternatives documented -->");
    expect(result).toContain("## Consequences");
    expect(result).toContain("<!-- No consequences documented -->");
  });

  test("includes categories in frontmatter", () => {
    const result = adrNote(
      makeOptions({
        categories: ["auth", "security"],
      })
    );

    expect(result).toContain("categories:");
    expect(result).toContain("  - auth");
    expect(result).toContain("  - security");
  });

  test("includes impacts in frontmatter and Related section", () => {
    const result = adrNote(
      makeOptions({
        impacts: ["auth-jwt", "api-gateway"],
      })
    );

    expect(result).toContain("impacts:");
    expect(result).toContain("  - auth-jwt");
    expect(result).toContain("  - api-gateway");
    expect(result).toContain("- Feature: [[auth-jwt]]");
    expect(result).toContain("- Feature: [[api-gateway]]");
  });

  test("renders consequences when provided", () => {
    const result = adrNote(
      makeOptions({
        consequences: "Stateless auth, no session store needed",
      })
    );

    expect(result).toContain("## Consequences");
    expect(result).toContain("Stateless auth, no session store needed");
    expect(result).not.toContain("<!-- No consequences documented -->");
  });

  test("zero-pads ADR number to 3 digits", () => {
    const result = adrNote(makeOptions({ adrNumber: 1 }));
    expect(result).toContain("# ADR-001:");

    const result2 = adrNote(makeOptions({ adrNumber: 42 }));
    expect(result2).toContain("# ADR-042:");

    const result3 = adrNote(makeOptions({ adrNumber: 100 }));
    expect(result3).toContain("# ADR-100:");
  });

  test("includes Related section with project links", () => {
    const result = adrNote(makeOptions());

    expect(result).toContain("## Related");
    expect(result).toContain("- Project: [[test-app/context|test-app]]");
    expect(result).toContain("- Decisions: [[test-app/decisions|test-app decisions]]");
  });
});
