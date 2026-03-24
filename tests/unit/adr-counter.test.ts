import { describe, test, expect, afterEach } from "bun:test";
import { getNextADRNumber, titleToSlug } from "../../src/lib/adr-counter";
import { ObsidianCLI } from "../../src/lib/obsidian-cli";

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

describe("getNextADRNumber", () => {
  const originalSpawn = Bun.spawn;

  afterEach(() => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
  });

  test("returns 1 when no ADRs exist", async () => {
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
    };

    const cli = new ObsidianCLI("TestVault");
    const num = await getNextADRNumber(cli, "test-app");
    expect(num).toBe(1);
  });

  test("returns max+1 when ADRs exist", async () => {
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({
        stdout: JSON.stringify([
          "Memory/Projects/test-app/ADRs/ADR-001-use-bun.md",
          "Memory/Projects/test-app/ADRs/ADR-002-jwt-auth.md",
          "Memory/Projects/test-app/ADRs/ADR-003-postgres.md",
        ]),
        stderr: "",
        exitCode: 0,
      });
    };

    const cli = new ObsidianCLI("TestVault");
    const num = await getNextADRNumber(cli, "test-app");
    expect(num).toBe(4);
  });

  test("handles non-sequential numbering (gaps)", async () => {
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({
        stdout: JSON.stringify([
          "Memory/Projects/test-app/ADRs/ADR-001-first.md",
          "Memory/Projects/test-app/ADRs/ADR-005-fifth.md",
          "Memory/Projects/test-app/ADRs/ADR-003-third.md",
        ]),
        stderr: "",
        exitCode: 0,
      });
    };

    const cli = new ObsidianCLI("TestVault");
    const num = await getNextADRNumber(cli, "test-app");
    expect(num).toBe(6);
  });

  test("returns 1 when search fails", async () => {
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({ stdout: "", stderr: "Error: path not found", exitCode: 1 });
    };

    const cli = new ObsidianCLI("TestVault");
    const num = await getNextADRNumber(cli, "test-app");
    expect(num).toBe(1);
  });
});

describe("titleToSlug", () => {
  test("converts title to kebab-case", () => {
    expect(titleToSlug("JWT Authentication over Session Cookies")).toBe(
      "jwt-authentication-over-session-cookies"
    );
  });

  test("strips special characters", () => {
    expect(titleToSlug("Use React (not Vue!)")).toBe("use-react-not-vue");
  });

  test("respects maxLength", () => {
    const result = titleToSlug("A Very Long Title That Exceeds The Maximum Length", 20);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  test("removes trailing hyphen after truncation", () => {
    const result = titleToSlug("One Two Three Four Five Six", 14);
    expect(result).not.toMatch(/-$/);
  });

  test("handles simple titles", () => {
    expect(titleToSlug("Use Bun", 40)).toBe("use-bun");
  });
});
