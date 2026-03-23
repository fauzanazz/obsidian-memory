import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runSaveDecision } from "../../src/commands/save-decision";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

function createMockProc(result: { stdout: string; stderr: string; exitCode: number }) {
  return {
    exited: Promise.resolve(result.exitCode),
    stdout: new Response(result.stdout).body!,
    stderr: new Response(result.stderr).body!,
    pid: 12345,
    killed: false,
    kill: () => {},
    ref: () => {},
    unref: () => {},
    stdin: undefined,
    exitCode: result.exitCode,
    signalCode: null,
    [Symbol.asyncDispose]: async () => {},
  };
}

describe("save-decision command", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "test-app",
      agents: ["claude-code"],
    });
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    await rm(tempDir, { recursive: true });
  });

  test("creates note at correct ADR path", async () => {
    let createdPath = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        if (pathArg) createdPath = pathArg.replace(/^path=/, "");
      }
      // search returns empty (no existing ADRs)
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    const { notePath, adrNumber } = await runSaveDecision(tempDir, {
      title: "Use Bun Runtime",
      context: "Need a fast JS runtime",
      decision: "Use Bun for all server-side code",
    });

    expect(adrNumber).toBe(1);
    expect(notePath).toMatch(
      /^Memory\/Projects\/test-app\/ADRs\/ADR-001-use-bun-runtime\.md$/
    );
    expect(createdPath).toBe(
      "Memory/Projects/test-app/ADRs/ADR-001-use-bun-runtime.md"
    );
  });

  test("auto-increments ADR number", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) {
        return createMockProc({
          stdout: JSON.stringify([
            "Memory/Projects/test-app/ADRs/ADR-001-first.md",
            "Memory/Projects/test-app/ADRs/ADR-002-second.md",
          ]),
          stderr: "",
          exitCode: 0,
        });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    const { adrNumber } = await runSaveDecision(tempDir, {
      title: "Third Decision",
      context: "Some context",
      decision: "Some decision",
    });

    expect(adrNumber).toBe(3);
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(
        runSaveDecision(emptyDir, {
          title: "Test",
          context: "ctx",
          decision: "dec",
        })
      ).rejects.toThrow("No .obsidian-memory.json found");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });

  test("updates decisions.md index with wikilink", async () => {
    let prependedContent = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      if (args.includes("prepend")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        if (contentArg) prependedContent = contentArg;
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveDecision(tempDir, {
      title: "Use Bun Runtime",
      context: "Need a fast runtime",
      decision: "Use Bun",
    });

    expect(prependedContent).toContain("ADR-001");
    expect(prependedContent).toContain("Use Bun Runtime");
    expect(prependedContent).toContain("accepted");
  });

  test("handles --supersedes flag: updates old ADR frontmatter", async () => {
    const setPropertyCalls: Array<{ path: string; name: string; value: string }> = [];
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) {
        // First search: getNextADRNumber — returns existing ADRs
        if (args.some((a) => a.includes("ADR-") && !a.includes("ADR-001"))) {
          return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
        }
        // Second search: looking for the superseded ADR
        if (args.some((a) => a.includes("ADR-001"))) {
          return createMockProc({
            stdout: JSON.stringify([
              "Memory/Projects/test-app/ADRs/ADR-001-old-decision.md",
            ]),
            stderr: "",
            exitCode: 0,
          });
        }
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      if (args.includes("property:set")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const nameArg = args.find((a) => a.startsWith("name="));
        const valueArg = args.find((a) => a.startsWith("value="));
        if (pathArg && nameArg && valueArg) {
          setPropertyCalls.push({
            path: pathArg.replace(/^path=/, ""),
            name: nameArg.replace(/^name=/, ""),
            value: valueArg.replace(/^value=/, ""),
          });
        }
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveDecision(tempDir, {
      title: "New Decision",
      context: "Replacing old approach",
      decision: "Do it differently",
      supersedes: 1,
    });

    expect(setPropertyCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "superseded_by",
          value: "1",
        }),
        expect.objectContaining({
          name: "status",
          value: "superseded",
        }),
      ])
    );
  });

  test("includes content with alternatives in created note", async () => {
    let capturedContent = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        if (contentArg) capturedContent = contentArg;
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveDecision(tempDir, {
      title: "Use Postgres",
      context: "Need a database",
      decision: "Use PostgreSQL",
      alternatives: ["MySQL: popular but less feature-rich", "SQLite: simple but not scalable"],
      consequences: "Need to run a Postgres server",
    });

    expect(capturedContent).toContain("Alternatives Considered");
    expect(capturedContent).toContain("MySQL");
    expect(capturedContent).toContain("SQLite");
    expect(capturedContent).toContain("Need to run a Postgres server");
  });
});
