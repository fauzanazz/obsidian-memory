import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runMaintain } from "../../src/commands/maintain";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

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

// Sample session content for testing
const SAMPLE_SESSION = `---
type: session
agent: claude-code
project: test-app
created: 2024-01-15
updated: 2024-01-15
tags:
  - session
  - agent/claude-code
  - project/test-app
---

# Session — 2024-01-15 — claude-code

## Summary
Implemented JWT authentication for the API.

## Decisions Made
- Use JWT tokens for stateless auth
- Store refresh tokens in httpOnly cookies

## Files Modified
- \`src/auth.ts\`
- \`src/middleware.ts\`
`;

const ENRICHED_SESSION = `---
type: session
agent: claude-code
project: test-app
created: 2024-01-15
updated: 2024-01-15
enriched: true
tags:
  - session
---

# Already enriched session
`;

const SAMPLE_ENRICHMENT_RESPONSE = JSON.stringify({
  features: [
    {
      slug: "auth-jwt",
      title: "JWT Authentication",
      summary: "JWT-based stateless auth for API",
      status: "completed",
      categories: ["auth"],
      keyFiles: [{ path: "src/auth.ts", role: "main auth module" }],
    },
  ],
  decisions: [
    {
      title: "Use JWT for auth",
      context: "Needed stateless authentication",
      decision: "Chose JWT over session cookies",
      categories: ["auth"],
      impacts: ["auth-jwt"],
      alternatives: [{ name: "Sessions", proscons: "Simpler but stateful" }],
      consequences: "Need token refresh logic",
    },
  ],
  crossLinks: {
    features_touched: ["auth-jwt"],
    decisions_made: ["Use JWT for auth"],
    topics: ["authentication", "security"],
  },
  contextDrift: null,
});

describe("maintain command", () => {
  let tempDir: string;
  const originalSpawn = Bun.spawn;
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "test-app",
      agents: ["claude-code"],
      llm: {
        provider: "gemini",
        model: "gemini-2.0-flash",
        apiKeyEnv: "GEMINI_API_KEY",
      },
    });
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-key" };
  });

  afterEach(async () => {
    // @ts-ignore
    Bun.spawn = originalSpawn;
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await rm(tempDir, { recursive: true });
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(
        runMaintain(emptyDir, { enrich: true })
      ).rejects.toThrow("No .obsidian-memory.json found");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });

  test("returns no-op message when no unenriched sessions exist", async () => {
    // Mock: search returns empty
    // @ts-ignore
    Bun.spawn = (cmd: string[]) => {
      const args = cmd as string[];
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    const result = await runMaintain(tempDir, { enrich: true });
    expect(result.message).toBe("No unenriched sessions found.");
    expect(result.sessionsEnriched).toBe(0);
  });

  test("skips sessions with enriched: true in frontmatter", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[]) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        return createMockProc({
          stdout: ENRICHED_SESSION,
          stderr: "",
          exitCode: 0,
        });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    const result = await runMaintain(tempDir, {
      enrich: true,
      session: "Memory/Sessions/test-app/2024-01-15-claude-code-abc123.md",
    });
    expect(result.message).toBe("No unenriched sessions found.");
    expect(result.sessionsEnriched).toBe(0);
  });

  test("enriches a specific session via --session", async () => {
    let createdNotes: string[] = [];

    // @ts-ignore
    Bun.spawn = (cmd: string[]) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        return createMockProc({
          stdout: SAMPLE_SESSION,
          stderr: "",
          exitCode: 0,
        });
      }
      if (args.includes("create")) {
        const pathArg = args.find((a) => a.startsWith("path="));
        if (pathArg) createdNotes.push(pathArg);
        return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    // Mock LLM response
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: SAMPLE_ENRICHMENT_RESPONSE }] } },
          ],
        }),
        { status: 200 }
      );

    const result = await runMaintain(tempDir, {
      enrich: true,
      session: "Memory/Sessions/test-app/2024-01-15-claude-code-abc123.md",
    });

    expect(result.sessionsEnriched).toBe(1);
    expect(result.featuresCreated).toContain("auth-jwt");
    expect(result.decisionsCreated).toHaveLength(1);
    expect(result.crossLinksAdded).toBe(1);
  });

  test("updates session frontmatter with enriched: true", async () => {
    let updatedContent = "";

    // @ts-ignore
    Bun.spawn = (cmd: string[]) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        return createMockProc({
          stdout: SAMPLE_SESSION,
          stderr: "",
          exitCode: 0,
        });
      }
      if (args.includes("create")) {
        const contentArg = args.find((a) => a.startsWith("content="));
        if (contentArg && args.some((a) => a.includes("overwrite"))) {
          updatedContent = contentArg;
        }
        return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: SAMPLE_ENRICHMENT_RESPONSE }] } },
          ],
        }),
        { status: 200 }
      );

    await runMaintain(tempDir, {
      enrich: true,
      session: "Memory/Sessions/test-app/2024-01-15-claude-code-abc123.md",
    });

    expect(updatedContent).toContain("enriched: true");
    expect(updatedContent).toContain("features_touched");
    expect(updatedContent).toContain("auth-jwt");
    expect(updatedContent).toContain("topics");
  });

  test("reports context drift warnings", async () => {
    const driftResponse = JSON.stringify({
      features: [],
      decisions: [],
      crossLinks: {
        features_touched: [],
        decisions_made: [],
        topics: ["graphql"],
      },
      contextDrift:
        "Session adds GraphQL but project context describes REST-only architecture",
    });

    // @ts-ignore
    Bun.spawn = (cmd: string[]) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        return createMockProc({
          stdout: SAMPLE_SESSION,
          stderr: "",
          exitCode: 0,
        });
      }
      if (args.includes("create")) {
        return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: driftResponse }] } }],
        }),
        { status: 200 }
      );

    const result = await runMaintain(tempDir, {
      enrich: true,
      session: "Memory/Sessions/test-app/2024-01-15-claude-code-abc123.md",
    });

    expect(result.contextDriftWarnings).toHaveLength(1);
    expect(result.contextDriftWarnings[0]).toContain("GraphQL");
    expect(result.message).toContain("Context drift detected");
  });

  test("handles LLM errors gracefully", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[]) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        return createMockProc({
          stdout: SAMPLE_SESSION,
          stderr: "",
          exitCode: 0,
        });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "ok", stderr: "", exitCode: 0 });
    };

    // LLM returns error
    globalThis.fetch = async () =>
      new Response("Internal Server Error", { status: 500 });

    const result = await runMaintain(tempDir, {
      enrich: true,
      session: "Memory/Sessions/test-app/2024-01-15-claude-code-abc123.md",
    });

    // Should not throw — gracefully handles error
    expect(result.sessionsEnriched).toBe(0);
    expect(result.featuresCreated).toHaveLength(0);
  });

  test("returns empty result when enrich flag is not set", async () => {
    const result = await runMaintain(tempDir, {});
    expect(result.sessionsEnriched).toBe(0);
    expect(result.message).toBe("");
  });
});
