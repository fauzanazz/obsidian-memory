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

// Vault content fixtures
const CONTEXT_MD = `---
title: my-app
---

# my-app

A TypeScript application built with Bun and Hono.
It provides a REST API for managing tasks.

## Tech Stack
TypeScript, Bun, Hono

## Architecture
Layered architecture with controllers, services, and repositories.`;

const PROGRESS_MD = `## Current State
In development, auth module complete.

## Blockers
Waiting on API key from external provider.

## History
- 2024-01-01: Project started`;

const DECISIONS_MD = `## Decision Log
- ADR-001: Use Bun for speed
- ADR-002: Use Hono for HTTP

## Decision: Use Bun
Chose Bun for its speed and TypeScript-first approach.

## Decision: Use Hono
Chose Hono for lightweight HTTP handling.`;

const FEATURES_MD = `## Feature Index
- auth: JWT authentication with refresh tokens
- tasks: CRUD operations for task management

## auth
Full JWT auth implementation with httpOnly cookies...`;

const MODULES_MD = `## Module Index
- src/commands/: CLI command handlers
- src/lib/: Core library code

## src/commands/
Handles all CLI commands...`;

const SESSION_MD = `## Summary
Implemented JWT authentication with refresh token rotation.

## Next Steps
- Add rate limiting
- Write integration tests

## Files Modified
- src/auth.ts
- src/middleware.ts`;

function createVaultMock() {
  return (cmd: string[], _opts?: any) => {
    const args = cmd as string[];

    // read commands
    if (args.includes("read")) {
      if (args.some((a) => a.includes("context.md"))) {
        return createMockProc({ stdout: CONTEXT_MD, stderr: "", exitCode: 0 });
      }
      if (args.some((a) => a.includes("progress.md"))) {
        return createMockProc({ stdout: PROGRESS_MD, stderr: "", exitCode: 0 });
      }
      if (args.some((a) => a.includes("decisions.md"))) {
        return createMockProc({ stdout: DECISIONS_MD, stderr: "", exitCode: 0 });
      }
      if (args.some((a) => a.includes("Features.md"))) {
        return createMockProc({ stdout: FEATURES_MD, stderr: "", exitCode: 0 });
      }
      if (args.some((a) => a.includes("Modules.md"))) {
        return createMockProc({ stdout: MODULES_MD, stderr: "", exitCode: 0 });
      }
      // Session file reads
      if (args.some((a) => a.includes("session"))) {
        return createMockProc({ stdout: SESSION_MD, stderr: "", exitCode: 0 });
      }
      // Default: file not found
      return createMockProc({ stdout: "", stderr: "error: file not found", exitCode: 1 });
    }

    // search commands
    if (args.includes("search")) {
      // Session search
      if (args.some((a) => a.includes("Sessions"))) {
        return createMockProc({
          stdout: JSON.stringify(["Memory/Sessions/my-app/2024-01-15-claude-code-abc123.md"]),
          stderr: "",
          exitCode: 0,
        });
      }
      // Convention search
      if (args.some((a) => a.includes("Conventions"))) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      // Focus search (project path)
      if (args.some((a) => a.includes("Projects"))) {
        const queryArg = args.find((a) => a.startsWith("query="));
        const query = queryArg?.split("=")[1] || "";
        if (query === "auth") {
          return createMockProc({
            stdout: JSON.stringify(["Memory/Projects/my-app/Docs/auth.md"]),
            stderr: "",
            exitCode: 0,
          });
        }
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
    }

    return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
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

  test("extracts ADR wikilinks from decisions.md as compact index", async () => {
    // Simulates decisions.md after save-decision prepends links at the top
    const decisionsContent = [
      "- [[ADRs/ADR-002-use-postgres|ADR-002: Use Postgres]] — accepted (2026-03-22)",
      "- [[ADRs/ADR-001-use-bun|ADR-001: Use Bun]] — accepted (2026-03-21)",
      "",
      "# Decisions — my-app",
      "",
      "> Architecture Decision Records. Newest first.",
      "",
      "## Decision Log",
      "",
      "<!-- New ADRs are automatically indexed here by save-decision -->",
      "",
      "---",
      "",
      "See also: [[Features]]",
    ].join("\n");

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("read") && args.some((a) => a.includes("context.md"))) {
        return createMockProc({ stdout: "# my-app", stderr: "", exitCode: 0 });
      }
      if (args.includes("read") && args.some((a) => a.includes("decisions.md"))) {
        return createMockProc({ stdout: decisionsContent, stderr: "", exitCode: 0 });
      }
      if (args.includes("read")) {
        return createMockProc({ stdout: "", stderr: "not found", exitCode: 1 });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir);
    expect(output).toContain("ADR-002: Use Postgres");
    expect(output).toContain("ADR-001: Use Bun");
    // Should NOT include the full file boilerplate
    expect(output).not.toContain("See also:");
    expect(output).not.toContain("<!-- New ADRs");
  });

  test("falls back to full decisions.md for old inline format", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("read") && args.some((a) => a.includes("context.md"))) {
        return createMockProc({ stdout: "# my-app", stderr: "", exitCode: 0 });
      }
      if (args.includes("read") && args.some((a) => a.includes("decisions.md"))) {
        return createMockProc({
          stdout: "## Decision: Use Bun\nChose Bun for speed\n## Decision: Use Hono\nChose Hono for the API",
          stderr: "",
          exitCode: 0,
        });
      }
      if (args.includes("read")) {
        return createMockProc({ stdout: "", stderr: "not found", exitCode: 1 });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir);
    // Old format — should include the full content
    expect(output).toContain("Use Bun");
    expect(output).toContain("Use Hono");
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

  // ── Default tier ──────────────────────────────────────────

  test("default tier produces Tier 1 + Tier 2 sections", async () => {
    // @ts-ignore
    Bun.spawn = createVaultMock();

    const output = await runLoadContext(tempDir);
    expect(output).toContain("Memory Context — my-app");

    // Tier 1: Project summary (first paragraph, not full content)
    expect(output).toContain("## Project");
    expect(output).toContain("A TypeScript application built with Bun and Hono.");

    // Tier 1: Current state
    expect(output).toContain("## Current State");
    expect(output).toContain("auth module complete");

    // Tier 2: Decisions (index format)
    expect(output).toContain("## Decisions");
    expect(output).toContain("ADR-001");

    // Should NOT contain full module documentation header (that's full mode)
    expect(output).not.toContain("## Module Documentation");
  });

  // ── Minimal tier ──────────────────────────────────────────

  test("--minimal produces only Tier 1", async () => {
    // @ts-ignore
    Bun.spawn = createVaultMock();

    const output = await runLoadContext(tempDir, { tier: "minimal" });
    expect(output).toContain("Memory Context — my-app");

    // Tier 1: Project summary
    expect(output).toContain("## Project");

    // Tier 1: Current state
    expect(output).toContain("## Current State");

    // Should NOT include Tier 2 content
    expect(output).not.toContain("## Decisions");
    expect(output).not.toContain("## Features");
    expect(output).not.toContain("## Modules");
    expect(output).not.toContain("## Recent Sessions");
    expect(output).not.toContain("## Convention");
  });

  // ── Focus tier ────────────────────────────────────────────

  test("--focus loads full content for matching notes", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];

      if (args.includes("read")) {
        if (args.some((a) => a.includes("context.md"))) {
          return createMockProc({ stdout: CONTEXT_MD, stderr: "", exitCode: 0 });
        }
        if (args.some((a) => a.includes("progress.md"))) {
          return createMockProc({ stdout: PROGRESS_MD, stderr: "", exitCode: 0 });
        }
        if (args.some((a) => a.includes("auth.md"))) {
          return createMockProc({
            stdout: "# Auth Module\n\nFull auth documentation here.",
            stderr: "",
            exitCode: 0,
          });
        }
        return createMockProc({ stdout: SESSION_MD, stderr: "", exitCode: 0 });
      }

      if (args.includes("search")) {
        if (args.some((a) => a.includes("Sessions")) && args.some((a) => a.includes("limit=1"))) {
          return createMockProc({
            stdout: JSON.stringify(["Memory/Sessions/my-app/session.md"]),
            stderr: "",
            exitCode: 0,
          });
        }
        if (args.some((a) => a.includes("Projects")) && args.some((a) => a.startsWith("query=auth"))) {
          return createMockProc({
            stdout: JSON.stringify(["Memory/Projects/my-app/Docs/auth.md"]),
            stderr: "",
            exitCode: 0,
          });
        }
        if (args.some((a) => a.includes("Sessions")) && args.some((a) => a.startsWith("query=auth"))) {
          return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
        }
        // Tier 2 searches
        if (args.some((a) => a.includes("Conventions"))) {
          return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
        }
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }

      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir, { focus: "auth" });
    expect(output).toContain("Memory Context — my-app");

    // Tier 1
    expect(output).toContain("## Project");

    // Tier 2 compact indexes
    expect(output).toContain("## Decisions");

    // Focus section with full content
    expect(output).toContain('## Focus: "auth"');
    expect(output).toContain("Full auth documentation here.");
  });

  test("--focus shows message when no notes match", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        if (args.some((a) => a.includes("context.md"))) {
          return createMockProc({ stdout: CONTEXT_MD, stderr: "", exitCode: 0 });
        }
        if (args.some((a) => a.includes("progress.md"))) {
          return createMockProc({ stdout: PROGRESS_MD, stderr: "", exitCode: 0 });
        }
        return createMockProc({ stdout: SESSION_MD, stderr: "", exitCode: 0 });
      }
      if (args.includes("search")) {
        if (args.some((a) => a.includes("Sessions")) && args.some((a) => a.includes("limit=1"))) {
          return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
        }
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir, { focus: "nonexistent" });
    expect(output).toContain("No matching notes found");
  });

  // ── Full tier ─────────────────────────────────────────────

  test("--full produces all content (backwards compatible)", async () => {
    // @ts-ignore
    Bun.spawn = createVaultMock();

    const output = await runLoadContext(tempDir, { tier: "full" });
    expect(output).toContain("Memory Context — my-app");

    // Full project context (replaces summary)
    expect(output).toContain("## Project Context");
    expect(output).toContain("Architecture");
    expect(output).toContain("Layered architecture");

    // Full progress (replaces compact)
    expect(output).toContain("## Progress");
    expect(output).toContain("History");

    // Full module documentation
    expect(output).toContain("## Module Documentation");
    expect(output).toContain("Handles all CLI commands");
  });

  // ── Existing flags ────────────────────────────────────────

  test("--no-decisions excludes decisions section", async () => {
    // @ts-ignore
    Bun.spawn = createVaultMock();

    const output = await runLoadContext(tempDir, { includeDecisions: false });
    expect(output).not.toContain("## Decisions");
    // Other sections should still be present
    expect(output).toContain("## Project");
  });

  test("--no-conventions excludes conventions", async () => {
    // @ts-ignore
    Bun.spawn = createVaultMock();

    const output = await runLoadContext(tempDir, { includeConventions: false });
    expect(output).not.toContain("## Convention");
  });

  test("--sessions 0 excludes sessions", async () => {
    // @ts-ignore
    Bun.spawn = createVaultMock();

    const output = await runLoadContext(tempDir, { includeSessions: 0 });
    expect(output).not.toContain("## Recent Sessions");
  });

  // ── Graceful fallbacks ────────────────────────────────────

  test("graceful fallback when vault is empty", async () => {
    // @ts-ignore
    Bun.spawn = (_cmd: string[], _opts?: any) => {
      return createMockProc({ stdout: "", stderr: "error: file not found", exitCode: 1 });
    };

    const output = await runLoadContext(tempDir, { tier: "minimal" });
    expect(output).toContain("No project context found");
  });

  test("backwards compatible with old decisions.md inline format", async () => {
    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts?: any) => {
      const args = cmd as string[];
      if (args.includes("read")) {
        if (args.some((a) => a.includes("context.md"))) {
          return createMockProc({ stdout: CONTEXT_MD, stderr: "", exitCode: 0 });
        }
        if (args.some((a) => a.includes("progress.md"))) {
          return createMockProc({ stdout: PROGRESS_MD, stderr: "", exitCode: 0 });
        }
        if (args.some((a) => a.includes("decisions.md"))) {
          // Old format: no "## Decision Log" header
          return createMockProc({
            stdout: "## Decision: Use Bun\nChose Bun for speed",
            stderr: "",
            exitCode: 0,
          });
        }
        return createMockProc({ stdout: "", stderr: "error: not found", exitCode: 1 });
      }
      if (args.includes("search")) {
        return createMockProc({ stdout: "[]", stderr: "", exitCode: 0 });
      }
      return createMockProc({ stdout: "", stderr: "", exitCode: 0 });
    };

    const output = await runLoadContext(tempDir);
    expect(output).toContain("## Decisions");
    expect(output).toContain("Chose Bun for speed");
  });
});
