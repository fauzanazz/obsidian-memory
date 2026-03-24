import { describe, test, expect, beforeEach, mock } from "bun:test";
import { distillSessions } from "../../src/lib/distiller";

const mockCallLLMJson = mock(() =>
  Promise.resolve({
    journal: {
      period: "2026-01",
      themes: ["Authentication", "API design"],
      accomplishments: "Built the auth system and API endpoints.",
      decisionsSummary: "Chose JWT over sessions for stateless auth.",
      patternsObserved: "TDD approach for all new features.",
      outstandingBlockers: ["Rate limiting not yet implemented"],
      weeklyBreakdown: [
        { week: "Week of 2026-01-06", highlights: ["Set up project structure", "Added JWT auth"] },
        { week: "Week of 2026-01-13", highlights: ["Built API endpoints"] },
      ],
    },
    contextUpdates: {
      currentState: "Auth system complete, API in progress",
      techStack: null,
      architecture: null,
    },
    newDecisions: [
      { title: "Use JWT over sessions", context: "Need stateless auth", decision: "JWT with short-lived tokens", consequences: "Must handle refresh" },
    ],
    newFeatures: [
      { slug: "jwt-auth", title: "JWT Authentication", summary: "JWT-based auth system", status: "completed" },
    ],
  })
);

mock.module("../../src/lib/llm", () => ({
  callLLMJson: mockCallLLMJson,
}));

describe("distillSessions", () => {
  beforeEach(() => { mockCallLLMJson.mockClear(); });

  test("returns empty result for empty session list", async () => {
    const result = await distillSessions([], "", "", "", "");
    expect(result.journal.period).toBe("");
    expect(result.journal.themes).toEqual([]);
    expect(result.newDecisions).toEqual([]);
    expect(result.newFeatures).toEqual([]);
    expect(result.contextUpdates).toBeNull();
    expect(mockCallLLMJson).not.toHaveBeenCalled();
  });

  test("sorts sessions chronologically before building prompt", async () => {
    const sessions = [
      { path: "Memory/Sessions/proj/2026-01-15-claude-abc.md", content: "Session 2", date: "2026-01-15" },
      { path: "Memory/Sessions/proj/2026-01-05-cursor-def.md", content: "Session 1", date: "2026-01-05" },
    ];
    await distillSessions(sessions, "ctx", "prog", "feat", "dec");
    expect(mockCallLLMJson).toHaveBeenCalledTimes(1);
    const prompt = mockCallLLMJson.mock.calls[0][0] as string;
    expect(prompt.indexOf("Session 1")).toBeLessThan(prompt.indexOf("Session 2"));
  });

  test("includes project context and indexes in prompt", async () => {
    const sessions = [{ path: "Memory/Sessions/proj/2026-01-10-claude-abc.md", content: "X", date: "2026-01-10" }];
    await distillSessions(sessions, "My context", "My progress", "Feature A", "Decision X");
    const prompt = mockCallLLMJson.mock.calls[0][0] as string;
    expect(prompt).toContain("My context");
    expect(prompt).toContain("My progress");
    expect(prompt).toContain("Feature A");
    expect(prompt).toContain("Decision X");
  });

  test("returns valid DistillationResult from LLM", async () => {
    const sessions = [{ path: "Memory/Sessions/proj/2026-01-10-claude-abc.md", content: "S", date: "2026-01-10" }];
    const result = await distillSessions(sessions, "", "", "", "");
    expect(result.journal.period).toBe("2026-01");
    expect(result.journal.themes).toHaveLength(2);
    expect(result.newDecisions).toHaveLength(1);
    expect(result.newFeatures).toHaveLength(1);
    expect(result.newFeatures[0].slug).toBe("jwt-auth");
    expect(result.contextUpdates).not.toBeNull();
  });

  test("uses default placeholders when context is empty", async () => {
    const sessions = [{ path: "Memory/Sessions/proj/2026-01-10-claude-abc.md", content: "X", date: "2026-01-10" }];
    await distillSessions(sessions, "", "", "", "");
    const prompt = mockCallLLMJson.mock.calls[0][0] as string;
    expect(prompt).toContain("_No context available._");
    expect(prompt).toContain("_No progress notes._");
    expect(prompt).toContain("_No features yet._");
    expect(prompt).toContain("_No decisions yet._");
  });

  test("passes llmConfig to callLLMJson", async () => {
    const sessions = [{ path: "Memory/Sessions/proj/2026-01-10-claude-abc.md", content: "X", date: "2026-01-10" }];
    const cfg = { provider: "gemini", model: "gemini-pro", apiKeyEnv: "MY_KEY" };
    await distillSessions(sessions, "", "", "", "", cfg);
    expect(mockCallLLMJson.mock.calls[0][1]).toEqual(cfg);
  });
});
