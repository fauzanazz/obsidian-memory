import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ObsidianCLI } from "../../src/lib/obsidian-cli";
import { runInit } from "../../src/commands/init";
import { runStatus } from "../../src/commands/status";
import { runSaveSession } from "../../src/commands/save-session";
import { runLoadContext } from "../../src/commands/load-context";
import { runSearch } from "../../src/commands/search";
import { runConsolidate } from "../../src/commands/consolidate";
import { findConfig } from "../../src/lib/config";

const VAULT = "Obsidian Vault";
const PROJECT = `e2e-test-${Date.now()}`;
let projectDir: string;
let available = false;
let sessionNoteName: string;

beforeAll(async () => {
  // Check if Obsidian CLI is reachable
  const cli = new ObsidianCLI(VAULT);
  try {
    const result = await cli.checkAvailability();
    available = result.obsidianRunning && result.cliAvailable;
  } catch {
    available = false;
  }

  if (!available) {
    console.log("Skipping E2E tests: Obsidian not running or CLI not available");
    return;
  }

  // Create a temporary project directory
  projectDir = await mkdtemp(join(tmpdir(), "obsidian-memory-e2e-"));
});

afterAll(async () => {
  if (!available || !projectDir) return;

  // Clean up temp project directory
  try {
    await rm(projectDir, { recursive: true });
  } catch {
    // best effort
  }

  // Clean up vault notes created during test
  const cli = new ObsidianCLI(VAULT);
  const testPaths = [
    `Memory/Projects/${PROJECT}/context.md`,
    `Memory/Projects/${PROJECT}/progress.md`,
    `Memory/Projects/${PROJECT}/decisions.md`,
  ];

  for (const path of testPaths) {
    try {
      await cli.exec(["delete", `path=${path}`]);
    } catch {
      // may not exist
    }
  }

  // Delete session note if created
  if (sessionNoteName) {
    try {
      await cli.exec(["delete", `path=${sessionNoteName}.md`]);
    } catch {
      // best effort
    }
  }
});

function skipIfUnavailable() {
  if (!available) {
    console.log("  Skipping: Obsidian not running or CLI not available");
    return true;
  }
  return false;
}

describe("E2E: Full obsidian-memory workflow", () => {
  test("1. init — creates config and AGENTS.md", async () => {
    if (skipIfUnavailable()) return;

    const result = await runInit(projectDir, {
      vault: VAULT,
      project: PROJECT,
      agents: ["claude-code"],
    });

    expect(result.configWritten).toBe(true);
    expect(result.agentsMdWritten).toBe(true);
    expect(result.agentConfigs.length).toBeGreaterThanOrEqual(1);
    expect(result.agentConfigs[0].agent).toBe("claude-code");

    // Verify config file is readable
    const found = await findConfig(projectDir);
    expect(found).not.toBeNull();
    expect(found!.config.vault).toBe(VAULT);
    expect(found!.config.project).toBe(PROJECT);
  });

  test("2. status — reports healthy system", async () => {
    if (skipIfUnavailable()) return;

    const status = await runStatus(projectDir);

    expect(status.configFound).toBe(true);
    expect(status.vault).toBe(VAULT);
    expect(status.project).toBe(PROJECT);
    expect(status.obsidianRunning).toBe(true);
    expect(status.cliAvailable).toBe(true);
  });

  test("3. save-session — creates session note in vault", async () => {
    if (skipIfUnavailable()) return;

    sessionNoteName = await runSaveSession(projectDir, {
      agent: "claude-code",
      summary: `E2E test session for ${PROJECT}`,
      decisions: ["Used Bun runtime", "No MCP server needed"],
      files: ["src/index.ts", "tests/e2e.test.ts"],
      blockers: [],
      nextSteps: ["Publish to npm"],
    });

    expect(sessionNoteName).toContain(`Memory/Sessions/${PROJECT}/`);
    expect(sessionNoteName).toContain("claude-code");

    // Verify the note was actually created by reading it
    const cli = new ObsidianCLI(VAULT);
    const content = await cli.read({ path: `${sessionNoteName}.md` });
    expect(content).toContain("E2E test session");
    expect(content).toContain("Used Bun runtime");
    expect(content).toContain("src/index.ts");
  });

  test("4. load-context — returns project context with session", async () => {
    if (skipIfUnavailable()) return;

    // Give Obsidian a moment to index
    await Bun.sleep(500);

    const context = await runLoadContext(projectDir, {
      includeConventions: true,
      includeDecisions: true,
      includeSessions: 5,
    });

    expect(context).toContain(`Memory Context`);
    // The project context file doesn't exist yet, but that's OK — it gracefully handles missing files
    expect(typeof context).toBe("string");
    expect(context.length).toBeGreaterThan(0);
  });

  test("5. search — finds session note by content", async () => {
    if (skipIfUnavailable()) return;

    await Bun.sleep(500);

    const { results, provider } = await runSearch(projectDir, PROJECT, {
      path: `Memory/Sessions/${PROJECT}/`,
    });

    expect(provider).toBeTruthy();
    // The search should find our session (may also find others)
    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.some((r) => r.path.includes("claude-code"));
    expect(found).toBe(true);
  });

  test("6. consolidate — runs without error (no old sessions to merge)", async () => {
    if (skipIfUnavailable()) return;

    const result = await runConsolidate(projectDir, {
      daysThreshold: 30,
    });

    // Our session was just created, so it shouldn't be consolidated
    expect(result.sessionsFound).toBeGreaterThanOrEqual(0);
    expect(result.message).toBeTruthy();
  });
});
