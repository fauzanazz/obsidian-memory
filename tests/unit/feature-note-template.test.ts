import { describe, test, expect } from "bun:test";
import { featureNote } from "../../src/templates/note-templates";
import type { FeatureNoteOptions } from "../../src/templates/note-templates";

function minimalOptions(): FeatureNoteOptions {
  return {
    project: "test-app",
    slug: "auth-jwt",
    title: "JWT Authentication",
    date: "2026-03-24",
    status: "in-progress",
  };
}

function fullOptions(): FeatureNoteOptions {
  return {
    project: "test-app",
    slug: "auth-jwt",
    title: "JWT Authentication",
    date: "2026-03-24",
    status: "completed",
    categories: ["auth", "security"],
    decidedBy: ["ADR-003-jwt-auth"],
    sessions: ["2026-03-21-claude-code-a1b2c3"],
    summary: "Token-based auth with httpOnly cookies",
    keyFiles: [
      { path: "src/auth.ts", role: "JWT signing and verification" },
      { path: "src/middleware.ts", role: "Auth middleware" },
    ],
    limitations: [
      "No refresh token rotation yet",
      "Only supports HS256 algorithm",
    ],
  };
}

describe("featureNote", () => {
  test("produces valid YAML frontmatter with all required fields", () => {
    const content = featureNote(minimalOptions());
    expect(content).toContain("---");
    expect(content).toContain("type: feature-note");
    expect(content).toContain("project: test-app");
    expect(content).toContain("feature: auth-jwt");
    expect(content).toContain("created: 2026-03-24");
    expect(content).toContain("updated: 2026-03-24");
    expect(content).toContain("status: in-progress");
    expect(content).toContain("  - feature");
    expect(content).toContain("  - project/test-app");
  });

  test("includes wikilinks in Related section", () => {
    const content = featureNote(minimalOptions());
    expect(content).toContain("## Related");
    expect(content).toContain("[[test-app/context|test-app]]");
    expect(content).toContain("[[Features|Feature Index]]");
  });

  test("renders keyFiles as a markdown table", () => {
    const content = featureNote(fullOptions());
    expect(content).toContain("| File | Role |");
    expect(content).toContain("|------|------|");
    expect(content).toContain("| `src/auth.ts` | JWT signing and verification |");
    expect(content).toContain("| `src/middleware.ts` | Auth middleware |");
  });

  test("with minimal options produces valid note with placeholders", () => {
    const content = featureNote(minimalOptions());
    expect(content).toContain("# JWT Authentication");
    expect(content).toContain("## Summary");
    expect(content).toContain("<!-- Agent: describe what this feature does -->");
    expect(content).toContain("## How It Works");
    expect(content).toContain("## Key Files");
    expect(content).toContain("<!-- Agent: add key files");
    expect(content).toContain("## Decisions & Trade-offs");
    expect(content).toContain("<!-- Agent: link to ADRs");
    expect(content).toContain("## Known Limitations");
    expect(content).toContain("<!-- Agent: document known limitations -->");
  });

  test("with all options renders every section", () => {
    const content = featureNote(fullOptions());

    // Frontmatter
    expect(content).toContain("status: completed");
    expect(content).toContain("categories:");
    expect(content).toContain("  - auth");
    expect(content).toContain("  - security");
    expect(content).toContain("decided_by:");
    expect(content).toContain("  - ADR-003-jwt-auth");
    expect(content).toContain("sessions:");
    expect(content).toContain("  - 2026-03-21-claude-code-a1b2c3");

    // Summary
    expect(content).toContain("Token-based auth with httpOnly cookies");

    // Key Files table
    expect(content).toContain("| `src/auth.ts` |");

    // Decisions wikilinks
    expect(content).toContain("- [[ADR-003-jwt-auth]]");

    // Limitations
    expect(content).toContain("- No refresh token rotation yet");
    expect(content).toContain("- Only supports HS256 algorithm");

    // Related sessions
    expect(content).toContain("- Session: [[2026-03-21-claude-code-a1b2c3]]");
  });

  test("does not include categories/sessions/decidedBy when not provided", () => {
    const content = featureNote(minimalOptions());
    expect(content).not.toContain("categories:");
    expect(content).not.toContain("decided_by:");
    expect(content).not.toContain("sessions:");
  });
});
