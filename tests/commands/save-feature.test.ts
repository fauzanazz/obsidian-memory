import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runSaveFeature } from "../../src/commands/save-feature";
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

describe("save-feature command", () => {
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

  test("creates note at correct path", async () => {
    let createdPath = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        if (pathArg) createdPath = pathArg.replace(/^path=/, "");
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    const result = await runSaveFeature(tempDir, {
      slug: "auth-jwt",
      title: "JWT Authentication",
    });

    expect(result).toBe("Memory/Projects/test-app/Features/auth-jwt");
    expect(createdPath).toBe("Memory/Projects/test-app/Features/auth-jwt.md");
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(
        runSaveFeature(emptyDir, { slug: "test", title: "Test" })
      ).rejects.toThrow("No .obsidian-memory.json found");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });

  test("includes categories in frontmatter", async () => {
    let capturedContent = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        if (contentArg) capturedContent = contentArg;
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveFeature(tempDir, {
      slug: "auth-jwt",
      title: "JWT Authentication",
      categories: ["auth", "security"],
    });

    expect(capturedContent).toContain("categories:");
    expect(capturedContent).toContain("auth");
    expect(capturedContent).toContain("security");
  });

  test("updates Features.md index with wikilink", async () => {
    let prependedContent = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("prepend")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        if (contentArg) prependedContent = contentArg;
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveFeature(tempDir, {
      slug: "auth-jwt",
      title: "JWT Authentication",
      summary: "Token-based auth with httpOnly cookies",
    });

    expect(prependedContent).toContain("Features/auth-jwt|JWT Authentication");
    expect(prependedContent).toContain("in-progress");
    expect(prependedContent).toContain("Token-based auth");
  });

  test("passes overwrite flag through to cli.create()", async () => {
    let hasOverwrite = false;
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create") && args.includes("overwrite")) {
        hasOverwrite = true;
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveFeature(tempDir, {
      slug: "auth-jwt",
      title: "JWT Authentication",
      overwrite: true,
    });

    expect(hasOverwrite).toBe(true);
  });

  test("defaults status to in-progress", async () => {
    let capturedContent = "";
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("create")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        if (contentArg) capturedContent = contentArg;
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    await runSaveFeature(tempDir, {
      slug: "test-feature",
      title: "Test Feature",
    });

    expect(capturedContent).toContain("status: in-progress");
  });
});
