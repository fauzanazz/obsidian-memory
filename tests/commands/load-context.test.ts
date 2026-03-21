import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runLoadContext } from "../../src/commands/load-context";
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

describe("load-context command", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "my-app",
      agents: ["claude-code"],
    });
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    await rm(tempDir, { recursive: true });
  });

  test("loads project context from vault", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      // read command for context.md
      if (args.includes("read") && args.some((a) => a.includes("context.md"))) {
        return createMockProc({
          stdout: "# my-app\n\n## Tech Stack\nTypeScript, Bun",
          stderr: "",
          exitCode: 0,
        });
      }
      // read command for progress.md
      if (args.includes("read") && args.some((a) => a.includes("progress.md"))) {
        return createMockProc({
          stdout: "## Current State\nIn development",
          stderr: "",
          exitCode: 0,
        });
      }
      // read command for decisions.md
      if (args.includes("read") && args.some((a) => a.includes("decisions.md"))) {
        return createMockProc({
          stdout: "## Decision: Use Bun\nChose Bun for speed",
          stderr: "",
          exitCode: 0,
        });
      }
      // search commands return empty
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir);
    expect(output).toContain("Memory Context — my-app");
    expect(output).toContain("TypeScript, Bun");
    expect(output).toContain("In development");
    expect(output).toContain("Use Bun");
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(runLoadContext(emptyDir)).rejects.toThrow(
        "No .obsidian-memory.json found"
      );
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });

  test("handles missing vault files gracefully", async () => {
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({
        stdout: "",
        stderr: "error: file not found",
        exitCode: 1,
      });
    };

    const output = await runLoadContext(tempDir);
    expect(output).toContain("No project context found");
  });
});
