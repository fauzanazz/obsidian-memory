import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runQuery } from "../../src/commands/query";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
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

describe("query command", () => {
  let tempDir: string;
  let vaultPath: string;
  const originalSpawn = Bun.spawn;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    vaultPath = join(tempDir, "vault");
    await mkdir(join(vaultPath, "Memory", "Events"), { recursive: true });
    await writeFile(join(vaultPath, "Memory", "Index.md"), "# Index\n");

    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "my-app",
      agents: ["claude-code"],
      vaultPath,
    });
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    await rm(tempDir, { recursive: true });
  });

  test("handles no matching events gracefully", async () => {
    // Mock Bun.spawn for ObsidianCLI search (keyword-only fallback, no API key)
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
    };

    const output = await runQuery(tempDir, "nonexistent-feature", {});
    expect(output).toContain("No matching events found");
    expect(output).toContain('Query: "nonexistent-feature"');
  });

  test("searches events and returns formatted results", async () => {
    const today = new Date().toISOString().split("T")[0];
    const events = [
      { date: today, type: "feature", summary: "Added authentication module", tags: ["auth"] },
      { date: today, type: "bugfix", summary: "Fixed auth token expiry", source: "Memory/Sessions/my-app/session1.md" },
      { date: today, type: "refactor", summary: "Improved database queries" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    // Mock Bun.spawn for ObsidianCLI search
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      if (args.includes("read")) {
        return createMockProc({
          stdout: "## Summary\nFixed auth token expiry issue\n\n## Next Steps\n- Add tests",
          stderr: "",
          exitCode: 0,
        });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runQuery(tempDir, "auth", {});
    expect(output).toContain('Query: "auth"');
    expect(output).toContain("Matching Events");
    expect(output).toContain("Added authentication module");
    expect(output).toContain("Fixed auth token expiry");
    // Should NOT include database query event (doesn't match "auth")
    expect(output).not.toContain("database queries");
  });

  test("links sessions from matching events", async () => {
    const today = new Date().toISOString().split("T")[0];
    const events = [
      {
        date: today,
        type: "feature",
        summary: "Added auth",
        source: "Memory/Sessions/my-app/2026-03-25-claude-code-abc123.md",
      },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      if (args.includes("read")) {
        return createMockProc({
          stdout: "## Summary\nImplemented JWT auth\n\n## Next Steps\n- Tests",
          stderr: "",
          exitCode: 0,
        });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runQuery(tempDir, "auth", {});
    expect(output).toContain("Related Sessions");
    expect(output).toContain("2026-03-25-claude-code-abc123.md");
    expect(output).toContain("Implemented JWT auth");
  });

  test("filters events by --since and --until", async () => {
    const events = [
      { date: "2026-03-20", type: "feature", summary: "Old auth change" },
      { date: "2026-03-25", type: "feature", summary: "New auth change" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
    };

    const output = await runQuery(tempDir, "auth", { since: "2026-03-24" });
    expect(output).toContain("New auth change");
    expect(output).not.toContain("Old auth change");
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(runQuery(emptyDir, "test", {})).rejects.toThrow("No .obsidian-memory.json found");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });
});
