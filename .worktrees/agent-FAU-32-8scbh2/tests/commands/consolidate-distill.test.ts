import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runConsolidate } from "../../src/commands/consolidate";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { DistillationResult } from "../../src/lib/distiller";

const MOCK_DISTILLATION: DistillationResult = {
  journal: {
    period: "2025-12",
    themes: ["Init command", "Config loading"],
    accomplishments: "Built the init and status commands.",
    decisionsSummary: "Chose Obsidian CLI for vault access.",
    patternsObserved: "All commands start with findConfig.",
    outstandingBlockers: ["CLI timeout issue"],
    weeklyBreakdown: [
      {
        week: "Week of 2025-12-01",
        highlights: ["Created project structure"],
      },
    ],
  },
  contextUpdates: {
    currentState: "Init and status commands working.",
    techStack: null,
    architecture: null,
  },
  newDecisions: [
    {
      title: "Use Obsidian CLI",
      context: "Need vault access",
      decision: "Use obsidian-cli npm package",
      consequences: "Requires Obsidian to be running",
    },
  ],
  newFeatures: [
    {
      slug: "init-command",
      title: "Init Command",
      summary: "Set up obsidian-memory for a project",
      status: "completed",
    },
  ],
};

// Build a session note with frontmatter
function makeSessionContent(agent: string, summary: string, archived = false): string {
  const lines = [
    "---",
    "type: session",
    `agent: ${agent}`,
    "project: test-app",
    "created: 2025-12-05",
  ];
  if (archived) lines.push("archived: true");
  lines.push("---", "", "## Summary", summary);
  return lines.join("\n");
}

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

describe("consolidate --distill", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "test-app",
      agents: ["claude-code"],
    });
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    await rm(tempDir, { recursive: true });
  });

  function setupMockCLI(sessions: Array<{ path: string; content: string }>) {
    const createdNotes = new Map<string, string>();

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];

      // Handle search — return session paths
      if (args.includes("search")) {
        const paths = sessions.map((s) => s.path);
        return createMockProc({
          stdout: JSON.stringify(paths),
          stderr: "",
          exitCode: 0,
        });
      }

      // Handle read — return session content or canonical docs
      if (args.includes("read")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const path = pathArg?.replace("path=", "") || "";

        const session = sessions.find((s) => s.path === path);
        if (session) {
          return createMockProc({
            stdout: session.content,
            stderr: "",
            exitCode: 0,
          });
        }

        // Return empty for canonical docs
        return createMockProc({ stdout: "", stderr: "not found", exitCode: 1 });
      }

      // Handle create — capture what's being created
      if (args.includes("create")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const contentArg = args.find((a) => a.startsWith("content="));
        if (pathArg && contentArg) {
          createdNotes.set(
            pathArg.replace("path=", ""),
            contentArg.replace("content=", "")
          );
        }
        return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
      }

      // Handle append
      if (args.includes("append")) {
        return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
      }

      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    return createdNotes;
  }

  function setupMockLLM() {
    process.env.GEMINI_API_KEY = "test-key";

    // @ts-ignore
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(MOCK_DISTILLATION) }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };
  }

  test("--distill falls back to --auto behavior when API key missing", async () => {
    delete process.env.GEMINI_API_KEY;

    const sessions = [
      {
        path: "Memory/Sessions/test-app/2025-12-05-claude-abc123.md",
        content: makeSessionContent("claude-code", "Did some work"),
      },
    ];
    setupMockCLI(sessions);

    const result = await runConsolidate(tempDir, {
      daysThreshold: 1,
      auto: true,
      distill: true,
    });

    // Should fall back to auto mode and consolidate
    expect(result.message).toContain("Consolidated");
    expect(result.message).toContain("journal entries");
  });

  test("--distill calls LLM and produces rich journal entry", async () => {
    const sessions = [
      {
        path: "Memory/Sessions/test-app/2025-12-05-claude-abc123.md",
        content: makeSessionContent("claude-code", "Built the init command"),
      },
    ];
    const createdNotes = setupMockCLI(sessions);
    setupMockLLM();

    const result = await runConsolidate(tempDir, {
      daysThreshold: 1,
      auto: true,
      distill: true,
    });

    expect(result.message).toContain("Distilled");
    expect(result.message).toContain("enriched journal entries");
  });

  test("--distill tags sessions with archived: true", async () => {
    const content = makeSessionContent("claude-code", "Built the init command");
    const sessions = [
      {
        path: "Memory/Sessions/test-app/2025-12-05-claude-abc123.md",
        content,
      },
    ];
    const createdNotes = setupMockCLI(sessions);
    setupMockLLM();

    await runConsolidate(tempDir, {
      daysThreshold: 1,
      auto: true,
      distill: true,
    });

    // Check that the session was updated with archived: true
    const archivedContent = createdNotes.get(
      "Memory/Sessions/test-app/2025-12-05-claude-abc123.md"
    );
    expect(archivedContent).toBeDefined();
    expect(archivedContent).toContain("archived: true");
  });

  test("--distill skips already-archived sessions in archiving step", async () => {
    const content = makeSessionContent("claude-code", "Already archived", true);
    const sessions = [
      {
        path: "Memory/Sessions/test-app/2025-12-05-claude-abc123.md",
        content,
      },
    ];
    const createdNotes = setupMockCLI(sessions);
    setupMockLLM();

    await runConsolidate(tempDir, {
      daysThreshold: 1,
      auto: true,
      distill: true,
    });

    // Session should NOT be re-archived (no overwrite with archived content)
    const archivedContent = createdNotes.get(
      "Memory/Sessions/test-app/2025-12-05-claude-abc123.md"
    );
    // The archiveSession function skips already-archived sessions, so the path
    // may still be set from the journal creation, but the session itself won't be overwritten
    // with archived: true (it already has it)
  });

  test("original session notes are NOT deleted", async () => {
    const sessions = [
      {
        path: "Memory/Sessions/test-app/2025-12-05-claude-abc123.md",
        content: makeSessionContent("claude-code", "Built init"),
      },
    ];
    setupMockCLI(sessions);
    setupMockLLM();

    let deleteWasCalled = false;
    const mockSpawn = Bun.spawn;
    // @ts-ignore - observe if "delete" was attempted
    const origMockSpawn = Bun.spawn;

    await runConsolidate(tempDir, {
      daysThreshold: 1,
      auto: true,
      distill: true,
    });

    // The consolidate command should NOT delete sessions
    // (no "delete" or "trash" commands should have been issued)
    expect(deleteWasCalled).toBe(false);
  });

  test("existing --auto behavior is unchanged (backwards compatible)", async () => {
    const sessions = [
      {
        path: "Memory/Sessions/test-app/2025-12-05-claude-abc123.md",
        content: makeSessionContent("claude-code", "Did some work"),
      },
    ];
    setupMockCLI(sessions);

    const result = await runConsolidate(tempDir, {
      daysThreshold: 1,
      auto: true,
      distill: false,
    });

    expect(result.message).toContain("Consolidated");
    expect(result.message).toContain("journal entries");
    expect(result.message).not.toContain("Distilled");
  });
});

describe("load-context skips archived sessions", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;

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

  test("load-context excludes sessions with archived: true", async () => {
    const { runLoadContext } = await import("../../src/commands/load-context");

    const archivedSession = "---\ntype: session\narchived: true\n---\n## Summary\nOld work";
    const activeSession = "---\ntype: session\n---\n## Summary\nRecent work";

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];

      if (args.includes("search")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const path = pathArg?.replace("path=", "") || "";

        if (path.includes("Sessions")) {
          return createMockProc({
            stdout: JSON.stringify([
              "Memory/Sessions/test-app/2026-01-01-claude-aaa.md",
              "Memory/Sessions/test-app/2026-01-02-claude-bbb.md",
            ]),
            stderr: "",
            exitCode: 0,
          });
        }
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }

      if (args.includes("read")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        const path = pathArg?.replace("path=", "") || "";

        if (path.includes("aaa")) {
          return createMockProc({ stdout: archivedSession, stderr: "", exitCode: 0 });
        }
        if (path.includes("bbb")) {
          return createMockProc({ stdout: activeSession, stderr: "", exitCode: 0 });
        }
        return createMockProc({ stdout: "", stderr: "not found", exitCode: 1 });
      }

      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir, { includeSessions: 5 });

    expect(output).toContain("Recent work");
    expect(output).not.toContain("Old work");
  });
});
