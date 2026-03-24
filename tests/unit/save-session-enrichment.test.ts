import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runSaveSession } from "../../src/commands/save-session";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Helper to create mock proc
function createMockProc(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}) {
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

describe("save-session enrichment", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-enrich-test-"));
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "test-app",
      agents: ["claude-code"],
    });

    // @ts-ignore
    Bun.spawn = () => {
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    if (originalGeminiKey) {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    await rm(tempDir, { recursive: true });
  });

  test("save-session succeeds without API key (no enrichment)", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await runSaveSession(tempDir, {
      agent: "claude-code",
      summary: "Implemented the CLI wrapper",
    });

    expect(result).toMatch(
      /^Memory\/Sessions\/test-app\/\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/,
    );
  });

  test("save-session succeeds even if enrichment would fail (no vault path)", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    // Config has no vaultPath and standard locations won't exist
    const result = await runSaveSession(tempDir, {
      agent: "claude-code",
      summary: "Test session",
      decisions: ["Use hybrid search"],
      files: ["src/lib/search.ts"],
    });

    // Should succeed — enrichment is skipped when vault path can't be resolved
    expect(result).toMatch(
      /^Memory\/Sessions\/test-app\/\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/,
    );
  });

  test("save-session succeeds even if event extraction throws", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    // Write config with explicit vaultPath that exists
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "test-app",
      agents: ["claude-code"],
      vaultPath: tempDir,
    });

    // extractEvents will fail because it calls the LLM with a fake key
    // but save-session should still succeed (fire-and-forget)
    const result = await runSaveSession(tempDir, {
      agent: "claude-code",
      summary: "Session that will have failed enrichment",
    });

    expect(result).toMatch(
      /^Memory\/Sessions\/test-app\/\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/,
    );
  });
});
