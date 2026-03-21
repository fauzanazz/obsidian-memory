import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runSaveSession } from "../../src/commands/save-session";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Helper to create mock proc
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

describe("save-session command", () => {
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

  test("creates a session note with correct name format", async () => {
    let createdName = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const nameArg = args.find((a) => a.startsWith('name='));
        if (nameArg) createdName = nameArg.replace(/^name="/, "").replace(/"$/, "");
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    const result = await runSaveSession(tempDir, {
      agent: "claude-code",
      summary: "Implemented the CLI wrapper",
    });

    expect(result).toMatch(/^Memory\/Sessions\/\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/);
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(
        runSaveSession(emptyDir, { agent: "test", summary: "test" })
      ).rejects.toThrow("No .obsidian-memory.json found");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });

  test("includes decisions in session content", async () => {
    let capturedContent = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const contentArg = args.find((a) => a.startsWith('content='));
        if (contentArg) capturedContent = contentArg;
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveSession(tempDir, {
      agent: "cursor",
      summary: "Added auth flow",
      decisions: ["Use JWT tokens", "Store in httpOnly cookies"],
    });

    expect(capturedContent).toContain("Decisions Made");
    expect(capturedContent).toContain("JWT tokens");
  });
});
