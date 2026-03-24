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
    await mkdir(join(vaultPath, "Memory", "Projects", "my-app"), { recursive: true });
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
      { date: today, subject: "authentication module", action: "implemented", object: "for user login", files: ["src/auth.ts"], aliases: ["auth setup"], source: "", extracted_at: "" },
      { date: today, subject: "auth token expiry", action: "fixed", object: "in middleware", files: ["src/middleware.ts"], aliases: ["token fix"], source: "Memory/Sessions/my-app/session1.md", extracted_at: "" },
      { date: today, subject: "database queries", action: "improved", object: "for performance", files: ["src/db.ts"], aliases: ["query optimization"], source: "", extracted_at: "" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
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
    expect(output).toContain("authentication module");
    expect(output).toContain("auth token expiry");
    // Should NOT include database query event (doesn't match "auth")
    expect(output).not.toContain("database queries");
  });

  test("links sessions from matching events", async () => {
    const today = new Date().toISOString().split("T")[0];
    const events = [
      {
        date: today,
        subject: "auth system",
        action: "implemented",
        object: "with JWT",
        files: ["src/auth.ts"],
        aliases: ["authentication"],
        source: "Memory/Sessions/my-app/2026-03-25-claude-code-abc123.md",
        extracted_at: "",
      },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
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

  test("filters events by --since", async () => {
    const events = [
      { date: "2026-03-20", subject: "auth", action: "changed", object: "old version", files: [], aliases: ["old auth change"], source: "", extracted_at: "" },
      { date: "2026-03-25", subject: "auth", action: "changed", object: "new version", files: [], aliases: ["new auth change"], source: "", extracted_at: "" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
    };

    const output = await runQuery(tempDir, "auth", { since: "2026-03-24" });
    expect(output).toContain("new version");
    expect(output).not.toContain("old version");
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
