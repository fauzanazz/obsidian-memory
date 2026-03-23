import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { runConsolidate } from "../../src/commands/consolidate";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

function createMockProc(result: { stdout: string; stderr: string; exitCode: number }) {
  return {
    exited: Promise.resolve(result.exitCode),
    stdout: new Response(result.stdout).body!,
    stderr: new Response(result.stderr).body!,
    pid: 12345, killed: false, kill: () => {}, ref: () => {}, unref: () => {},
    stdin: undefined, exitCode: result.exitCode, signalCode: null,
    [Symbol.asyncDispose]: async () => {},
  };
}

const mockDistillResult = {
  journal: {
    period: "2025-12",
    themes: ["Feature work"],
    accomplishments: "Built features.",
    decisionsSummary: "Decided TDD.",
    patternsObserved: "Test-first.",
    outstandingBlockers: [] as string[],
    weeklyBreakdown: [{ week: "Week of 2025-12-01", highlights: ["Built auth"] }],
  },
  contextUpdates: null,
  newDecisions: [] as any[],
  newFeatures: [] as any[],
};

const mockDistillSessions = mock(() => Promise.resolve(mockDistillResult));
mock.module("../../src/lib/distiller", () => ({ distillSessions: mockDistillSessions }));

describe("consolidate --distill", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;
  const origEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    await writeConfig(tempDir, { vault: "TestVault", project: "test-app", agents: ["claude-code"] });
    mockDistillSessions.mockClear();
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    process.env = { ...origEnv };
    await rm(tempDir, { recursive: true });
  });

  function setupMockSpawn(sessions?: Map<string, string>) {
    const contents = sessions ?? new Map([
      ["Memory/Sessions/test-app/2025-12-01-claude-abc123.md", "---\ntype: session\n---\n## Summary\nDid auth"],
      ["Memory/Sessions/test-app/2025-12-15-cursor-def456.md", "---\ntype: session\n---\n## Summary\nDid API"],
    ]);
    const searchResults = JSON.stringify(Array.from(contents.keys()));

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) return createMockProc({ stdout: searchResults, stderr: "", exitCode: 0 });
      if (args.includes("read")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const path = pathArg?.replace("path=", "") || "";
        const content = contents.get(path) || "";
        return createMockProc({ stdout: content, stderr: content ? "" : "Not found", exitCode: content ? 0 : 1 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };
  }

  test("calls LLM and produces rich journal entry", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    setupMockSpawn();
    const result = await runConsolidate(tempDir, { daysThreshold: 1, distill: true });
    expect(mockDistillSessions).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("Distilled");
    expect(result.message).toContain("enriched journal entries");
  });

  test("falls back to --auto when API key missing", async () => {
    delete process.env.GEMINI_API_KEY;
    setupMockSpawn();
    const result = await runConsolidate(tempDir, { daysThreshold: 1, auto: true, distill: true });
    expect(mockDistillSessions).not.toHaveBeenCalled();
    expect(result.message).toContain("Consolidated");
  });

  test("tags sessions with archived: true", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const archivedContents: string[] = [];
    const sessions = new Map([
      ["Memory/Sessions/test-app/2025-12-01-claude-abc123.md", "---\ntype: session\nagent: claude\n---\n## Summary\nWork"],
    ]);
    const searchResults = JSON.stringify(Array.from(sessions.keys()));

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) return createMockProc({ stdout: searchResults, stderr: "", exitCode: 0 });
      if (args.includes("read")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const path = pathArg?.replace("path=", "") || "";
        const content = sessions.get(path) || "";
        return createMockProc({ stdout: content, stderr: content ? "" : "Not found", exitCode: content ? 0 : 1 });
      }
      if (args.includes("create")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        const pathArg = args.find((a) => a.startsWith("path="));
        if (contentArg && pathArg?.includes("Sessions/")) archivedContents.push(contentArg);
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runConsolidate(tempDir, { daysThreshold: 1, distill: true });
    expect(archivedContents.some((c) => c.includes("archived: true"))).toBe(true);
  });

  test("existing --auto behavior unchanged", async () => {
    setupMockSpawn();
    const result = await runConsolidate(tempDir, { daysThreshold: 1, auto: true });
    expect(mockDistillSessions).not.toHaveBeenCalled();
    expect(result.message).toContain("Consolidated");
  });

  test("creates decision notes for discovered decisions", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockDistillSessions.mockImplementationOnce(() => Promise.resolve({
      ...mockDistillResult,
      newDecisions: [{ title: "Use JWT", context: "Need auth", decision: "JWT", consequences: "Refresh" }],
    }));
    const createdPaths: string[] = [];
    const sessions = new Map([
      ["Memory/Sessions/test-app/2025-12-01-claude-abc.md", "---\ntype: session\n---\n## Summary\nAuth"],
    ]);
    const searchResults = JSON.stringify(Array.from(sessions.keys()));

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) return createMockProc({ stdout: searchResults, stderr: "", exitCode: 0 });
      if (args.includes("read")) {
        const p = args.find((a) => a.startsWith("path="))?.replace("path=", "") || "";
        const c = sessions.get(p) || "";
        return createMockProc({ stdout: c, stderr: c ? "" : "Not found", exitCode: c ? 0 : 1 });
      }
      if (args.includes("create")) {
        const pa = args.find((a) => a.startsWith("path="));
        if (pa) createdPaths.push(pa.replace("path=", ""));
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runConsolidate(tempDir, { daysThreshold: 1, distill: true });
    expect(createdPaths.some((p) => p.includes("Decisions/"))).toBe(true);
  });

  test("creates feature notes for discovered features", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockDistillSessions.mockImplementationOnce(() => Promise.resolve({
      ...mockDistillResult,
      newFeatures: [{ slug: "jwt-auth", title: "JWT Auth", summary: "Auth system", status: "completed" }],
    }));
    const createdPaths: string[] = [];
    const sessions = new Map([
      ["Memory/Sessions/test-app/2025-12-01-claude-abc.md", "---\ntype: session\n---\n## Summary\nAuth"],
    ]);
    const searchResults = JSON.stringify(Array.from(sessions.keys()));

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) return createMockProc({ stdout: searchResults, stderr: "", exitCode: 0 });
      if (args.includes("read")) {
        const p = args.find((a) => a.startsWith("path="))?.replace("path=", "") || "";
        const c = sessions.get(p) || "";
        return createMockProc({ stdout: c, stderr: c ? "" : "Not found", exitCode: c ? 0 : 1 });
      }
      if (args.includes("create")) {
        const pa = args.find((a) => a.startsWith("path="));
        if (pa) createdPaths.push(pa.replace("path=", ""));
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runConsolidate(tempDir, { daysThreshold: 1, distill: true });
    expect(createdPaths.some((p) => p.includes("Features/"))).toBe(true);
  });
});
