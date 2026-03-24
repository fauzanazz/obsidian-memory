import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { distillSessions } from "../../src/lib/distiller";
import type { DistillationResult } from "../../src/lib/distiller";

// Mock LLM response
const mockDistillationResult: DistillationResult = {
  journal: {
    period: "2026-02",
    themes: ["CLI development", "Memory architecture", "Testing infrastructure"],
    accomplishments:
      "Built the core CLI wrapper and session management system.",
    decisionsSummary:
      "Chose Bun runtime for speed. Used Obsidian CLI for vault access.",
    patternsObserved: "Convention of using frontmatter for all note metadata.",
    outstandingBlockers: ["Obsidian CLI lacks batch operations"],
    weeklyBreakdown: [
      {
        week: "Week of 2026-02-03",
        highlights: ["Implemented session saving", "Added search command"],
      },
      {
        week: "Week of 2026-02-10",
        highlights: ["Built load-context command"],
      },
    ],
  },
  contextUpdates: {
    currentState: "Core CLI is functional with session and search support.",
    techStack: null,
    architecture: null,
  },
  newDecisions: [
    {
      title: "Use Bun runtime",
      context: "Needed a fast JS runtime for CLI tool.",
      decision: "Use Bun instead of Node.js.",
      consequences: "Faster startup, but limits deployment to Bun-compatible environments.",
    },
  ],
  newFeatures: [
    {
      slug: "session-management",
      title: "Session Management",
      summary: "Save and load session notes with full metadata.",
      status: "completed",
    },
  ],
};

describe("distillSessions", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  });

  test("returns empty result for empty session list", async () => {
    const result = await distillSessions([], "", "", "", "");
    expect(result.journal.period).toBe("");
    expect(result.journal.themes).toEqual([]);
    expect(result.newDecisions).toEqual([]);
    expect(result.newFeatures).toEqual([]);
    expect(result.contextUpdates).toBeNull();
  });

  test("builds prompt with all sessions sorted chronologically", async () => {
    let capturedBody = "";

    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async (input: any, init?: any) => {
      capturedBody = init?.body || "";
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockDistillationResult) }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const sessions = [
      { path: "Memory/Sessions/proj/2026-02-10-claude-abc123.md", content: "Session B", date: "2026-02-10" },
      { path: "Memory/Sessions/proj/2026-02-03-cursor-def456.md", content: "Session A", date: "2026-02-03" },
    ];

    await distillSessions(sessions, "project ctx", "progress", "features", "decisions");

    const parsed = JSON.parse(capturedBody);
    const promptText = parsed.contents[0].parts[0].text;

    // Session A (earlier date) should appear before Session B
    const idxA = promptText.indexOf("Session A");
    const idxB = promptText.indexOf("Session B");
    expect(idxA).toBeLessThan(idxB);
  });

  test("includes project context and indexes in prompt", async () => {
    let capturedBody = "";

    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async (_input: any, init?: any) => {
      capturedBody = init?.body || "";
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockDistillationResult) }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const sessions = [
      { path: "Memory/Sessions/proj/2026-02-03-claude-abc.md", content: "test session", date: "2026-02-03" },
    ];

    await distillSessions(
      sessions,
      "My project context",
      "Current progress notes",
      "Feature list here",
      "Decision log here"
    );

    const parsed = JSON.parse(capturedBody);
    const promptText = parsed.contents[0].parts[0].text;

    expect(promptText).toContain("My project context");
    expect(promptText).toContain("Current progress notes");
    expect(promptText).toContain("Feature list here");
    expect(promptText).toContain("Decision log here");
  });

  test("returns valid DistillationResult from LLM response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockDistillationResult) }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const sessions = [
      { path: "Memory/Sessions/proj/2026-02-03-claude-abc.md", content: "test", date: "2026-02-03" },
    ];

    const result = await distillSessions(sessions, "", "", "", "");

    expect(result.journal.period).toBe("2026-02");
    expect(result.journal.themes).toHaveLength(3);
    expect(result.newDecisions).toHaveLength(1);
    expect(result.newDecisions[0].title).toBe("Use Bun runtime");
    expect(result.newFeatures).toHaveLength(1);
    expect(result.newFeatures[0].slug).toBe("session-management");
    expect(result.contextUpdates?.currentState).toBeTruthy();
  });

  test("uses fallback text when context is empty", async () => {
    let capturedBody = "";

    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async (_input: any, init?: any) => {
      capturedBody = init?.body || "";
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockDistillationResult) }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const sessions = [
      { path: "Memory/Sessions/proj/2026-02-03-claude-abc.md", content: "test", date: "2026-02-03" },
    ];

    await distillSessions(sessions, "", "", "", "");

    const parsed = JSON.parse(capturedBody);
    const promptText = parsed.contents[0].parts[0].text;

    expect(promptText).toContain("_No context available._");
    expect(promptText).toContain("_No progress notes._");
    expect(promptText).toContain("_No features yet._");
    expect(promptText).toContain("_No decisions yet._");
  });

  test("throws when API key is not set", async () => {
    delete process.env.GEMINI_API_KEY;

    const sessions = [
      { path: "Memory/Sessions/proj/2026-02-03-claude-abc.md", content: "test", date: "2026-02-03" },
    ];

    await expect(
      distillSessions(sessions, "", "", "", "")
    ).rejects.toThrow("LLM API key not found");
  });
});
