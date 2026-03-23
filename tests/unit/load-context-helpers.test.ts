import { describe, test, expect } from "bun:test";
import {
  extractSummary,
  extractProgressCompact,
  extractSection,
  truncate,
} from "../../src/commands/load-context";

describe("extractSummary", () => {
  test("strips frontmatter and returns first paragraph", () => {
    const content = `---
title: My Project
tags: [project]
---

# My Project

This is a TypeScript project that does amazing things.
It uses Bun as the runtime.

## Tech Stack

- TypeScript
- Bun`;

    const result = extractSummary(content);
    expect(result).toBe(
      "This is a TypeScript project that does amazing things.\nIt uses Bun as the runtime."
    );
  });

  test("returns first paragraph when no frontmatter", () => {
    const content = `# My Project

A simple project description.

## Details

More details here.`;

    const result = extractSummary(content);
    expect(result).toBe("A simple project description.");
  });

  test("returns fallback when no content", () => {
    const result = extractSummary("");
    expect(result).toBe("_No summary available._");
  });

  test("returns fallback for headers-only content", () => {
    const content = `# Title
## Section 1
## Section 2`;

    const result = extractSummary(content);
    expect(result).toBe("_No summary available._");
  });

  test("skips HTML comments", () => {
    const content = `# Project
<!-- This is a comment -->
Actual content here.`;

    const result = extractSummary(content);
    expect(result).toBe("Actual content here.");
  });
});

describe("extractProgressCompact", () => {
  test("extracts Current State and Blockers", () => {
    const content = `## Current State
In development, auth module complete.

## Blockers
Waiting on API key from external provider.

## History
Old stuff here.`;

    const result = extractProgressCompact(content);
    expect(result).toContain("**Current state:**");
    expect(result).toContain("In development, auth module complete.");
    expect(result).toContain("**Blockers:**");
    expect(result).toContain("Waiting on API key from external provider.");
  });

  test("returns null when both sections empty", () => {
    const content = `## Other Section
Some content here.`;

    const result = extractProgressCompact(content);
    expect(result).toBeNull();
  });

  test("works with only Current State", () => {
    const content = `## Current State
Working on feature X.`;

    const result = extractProgressCompact(content);
    expect(result).toContain("**Current state:**");
    expect(result).toContain("Working on feature X.");
    expect(result).not.toContain("**Blockers:**");
  });

  test("works with only Blockers", () => {
    const content = `## Blockers
Need API access.`;

    const result = extractProgressCompact(content);
    expect(result).toContain("**Blockers:**");
    expect(result).toContain("Need API access.");
    expect(result).not.toContain("**Current state:**");
  });
});

describe("extractSection", () => {
  test("extracts content between headings", () => {
    const content = `## Summary
This is the summary content.

## Next Steps
- Step 1
- Step 2`;

    const result = extractSection(content, "Summary");
    expect(result).toContain("This is the summary content.");
  });

  test("extracts content until end of file", () => {
    const content = `## Notes
These are the final notes.
More notes here.`;

    const result = extractSection(content, "Notes");
    expect(result).toContain("These are the final notes.");
    expect(result).toContain("More notes here.");
  });

  test("returns null for missing heading", () => {
    const content = `## Summary
Some content.`;

    const result = extractSection(content, "Missing");
    expect(result).toBeNull();
  });

  test("extracts until --- separator", () => {
    const content = `## Decision Log
- Decision 1
- Decision 2

---

Some other content.`;

    const result = extractSection(content, "Decision Log");
    expect(result).toContain("Decision 1");
    expect(result).toContain("Decision 2");
    expect(result).not.toContain("Some other content");
  });
});

describe("truncate", () => {
  test("returns string unchanged when shorter than limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("returns string unchanged when equal to limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("truncates with ellipsis when longer than limit", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  test("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});
