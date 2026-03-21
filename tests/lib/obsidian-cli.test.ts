import { describe, test, expect, beforeEach } from "bun:test";
import { ObsidianCLI, escapeContent } from "../../src/lib/obsidian-cli";

// Mock Bun.spawn for all tests
let mockSpawnResult: { stdout: string; stderr: string; exitCode: number };

const originalSpawn = Bun.spawn;

function createMockProc(result: typeof mockSpawnResult) {
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

describe("escapeContent", () => {
  test("escapes newlines to \\n", () => {
    expect(escapeContent("line1\nline2\nline3")).toBe("line1\\nline2\\nline3");
  });

  test("escapes tabs to \\t", () => {
    expect(escapeContent("col1\tcol2")).toBe("col1\\tcol2");
  });

  test("escapes double quotes", () => {
    expect(escapeContent('say "hello"')).toBe('say \\"hello\\"');
  });

  test("escapes backslashes before other escapes", () => {
    expect(escapeContent("path\\to\\file\n")).toBe("path\\\\to\\\\file\\n");
  });

  test("handles complex multiline content", () => {
    const input = '---\ntype: session\nagent: "claude"\n---\n\n# Title\n\nContent here.';
    const expected = '---\\ntype: session\\nagent: \\"claude\\"\\n---\\n\\n# Title\\n\\nContent here.';
    expect(escapeContent(input)).toBe(expected);
  });
});

describe("ObsidianCLI", () => {
  let cli: ObsidianCLI;

  beforeEach(() => {
    cli = new ObsidianCLI("TestVault");
    mockSpawnResult = { stdout: "", stderr: "", exitCode: 0 };
  });

  describe("constructor", () => {
    test("stores vault name", () => {
      const c = new ObsidianCLI("MyVault");
      expect(c.vault).toBe("MyVault");
    });
  });

  describe("exec", () => {
    test("builds correct command with vault prefix", async () => {
      let capturedArgs: string[] = [];
      const origSpawn = Bun.spawn;
      // @ts-ignore - mocking
      Bun.spawn = (cmd: string[], opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
      };

      try {
        await cli.exec(["read", 'file="Test"']);
        expect(capturedArgs[0]).toBe("obsidian");
        expect(capturedArgs[1]).toBe('vault=TestVault');
        expect(capturedArgs[2]).toBe("read");
        expect(capturedArgs[3]).toBe('file="Test"');
      } finally {
        // @ts-ignore
        Bun.spawn = origSpawn;
      }
    });

    test("throws on non-zero exit code", async () => {
      // @ts-ignore
      Bun.spawn = (_cmd: string[], _opts?: any) => {
        return createMockProc({ stdout: "", stderr: "error: vault not found", exitCode: 1 });
      };

      try {
        await expect(cli.exec(["read"])).rejects.toThrow("vault not found");
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("read", () => {
    test("reads a note by name", async () => {
      // @ts-ignore
      Bun.spawn = (_cmd: string[], _opts?: any) => {
        return createMockProc({
          stdout: "# My Note\n\nSome content here.",
          stderr: "",
          exitCode: 0,
        });
      };

      try {
        const content = await cli.read({ file: "My Note" });
        expect(content).toBe("# My Note\n\nSome content here.");
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });

    test("reads a note by path", async () => {
      let capturedArgs: string[] = [];
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "content", stderr: "", exitCode: 0 });
      };

      try {
        await cli.read({ path: "Memory/Projects/test/context.md" });
        expect(capturedArgs).toContain('path="Memory/Projects/test/context.md"');
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("create", () => {
    test("creates a note with name and content", async () => {
      let capturedArgs: string[] = [];
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "Created: Memory/test.md", stderr: "", exitCode: 0 });
      };

      try {
        await cli.create({
          name: "Memory/Projects/test/context",
          content: "# Test Project\n\nContext here.",
        });
        expect(capturedArgs).toContain("create");
        expect(capturedArgs.some((a) => a.startsWith('name='))).toBe(true);
        const contentArg = capturedArgs.find((a) => a.startsWith('content='));
        expect(contentArg).toBe('content="# Test Project\\n\\nContext here."');
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });

    test("passes silent flag", async () => {
      let capturedArgs: string[] = [];
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
      };

      try {
        await cli.create({ name: "test", content: "x", silent: true });
        expect(capturedArgs).toContain("silent");
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("append", () => {
    test("appends content to a note", async () => {
      let capturedArgs: string[] = [];
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
      };

      try {
        await cli.append({ file: "Journal", content: "New entry" });
        expect(capturedArgs).toContain("append");
        expect(capturedArgs.some((a) => a.startsWith('file='))).toBe(true);
        expect(capturedArgs.some((a) => a.startsWith('content='))).toBe(true);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("search", () => {
    test("searches with query and returns JSON results", async () => {
      const mockResults = JSON.stringify([
        { path: "Memory/Projects/test/context.md", matches: ["test context"] },
        { path: "Memory/Sessions/2026-03-20-claude.md", matches: ["test session"] },
      ]);

      // @ts-ignore
      Bun.spawn = (_cmd: string[], _opts?: any) => {
        return createMockProc({ stdout: mockResults, stderr: "", exitCode: 0 });
      };

      try {
        const results = await cli.search("test");
        expect(results).toHaveLength(2);
        expect(results[0].path).toBe("Memory/Projects/test/context.md");
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });

    test("passes path filter", async () => {
      let capturedArgs: string[] = [];
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      };

      try {
        await cli.search("test", { path: "Memory/Projects/" });
        expect(capturedArgs.some((a) => a.startsWith('path='))).toBe(true);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("getProperties", () => {
    test("returns parsed properties for a note", async () => {
      const mockOutput = "type: session\nagent: claude-code\nproject: test-app\ncreated: 2026-03-20";

      // @ts-ignore
      Bun.spawn = (_cmd: string[], _opts?: any) => {
        return createMockProc({ stdout: mockOutput, stderr: "", exitCode: 0 });
      };

      try {
        const props = await cli.getProperties({ file: "test-session" });
        expect(props.type).toBe("session");
        expect(props.agent).toBe("claude-code");
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("setProperty", () => {
    test("sets a property on a note", async () => {
      let capturedArgs: string[] = [];
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        capturedArgs = cmd as string[];
        return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
      };

      try {
        await cli.setProperty({ file: "test", name: "updated", value: "2026-03-21" });
        expect(capturedArgs).toContain("property:set");
        expect(capturedArgs.some((a) => a.startsWith('name='))).toBe(true);
        expect(capturedArgs.some((a) => a.startsWith('value='))).toBe(true);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("getTags", () => {
    test("lists files with a specific tag", async () => {
      const mockOutput = JSON.stringify([
        "Memory/Projects/test/context.md",
        "Memory/Conventions/coding.md",
      ]);

      // @ts-ignore
      Bun.spawn = (_cmd: string[], _opts?: any) => {
        return createMockProc({ stdout: mockOutput, stderr: "", exitCode: 0 });
      };

      try {
        const files = await cli.getFilesWithTag("project/test");
        expect(files).toHaveLength(2);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("getBacklinks", () => {
    test("returns backlinks for a note", async () => {
      const mockOutput = JSON.stringify([
        "Memory/Sessions/2026-03-20-claude.md",
        "Memory/Projects/test/decisions.md",
      ]);

      // @ts-ignore
      Bun.spawn = (_cmd: string[], _opts?: any) => {
        return createMockProc({ stdout: mockOutput, stderr: "", exitCode: 0 });
      };

      try {
        const backlinks = await cli.getBacklinks({ file: "test-context" });
        expect(backlinks).toHaveLength(2);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("checkAvailability", () => {
    test("returns true when obsidian is available", async () => {
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        const c = cmd as string[];
        if (c.includes("version")) {
          return createMockProc({ stdout: "1.12.4", stderr: "", exitCode: 0 });
        }
        if (c[0] === "pgrep") {
          return createMockProc({ stdout: "12345", stderr: "", exitCode: 0 });
        }
        return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
      };

      try {
        const result = await cli.checkAvailability();
        expect(result.obsidianRunning).toBe(true);
        expect(result.cliAvailable).toBe(true);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });

    test("returns false when obsidian is not running", async () => {
      // @ts-ignore
      Bun.spawn = (cmd: string[], _opts?: any) => {
        const c = cmd as string[];
        if (c[0] === "pgrep") {
          return createMockProc({ stdout: "", stderr: "", exitCode: 1 });
        }
        if (c.includes("version")) {
          return createMockProc({ stdout: "1.12.4", stderr: "", exitCode: 0 });
        }
        return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
      };

      try {
        const result = await cli.checkAvailability();
        expect(result.obsidianRunning).toBe(false);
        expect(result.cliAvailable).toBe(true);
      } finally {
        // @ts-ignore
        Bun.spawn = originalSpawn;
      }
    });
  });
});
