import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runSaveSession } from "../../src/commands/save-session";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("save-session enrichment", () => {
  let tempDir: string;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-enrich-test-"));
    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "test-app",
      agents: ["claude-code"],
    });
  });

  afterEach(async () => {
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

    // v2: returns session ID (not vault path)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/);
  });

  test("save-session succeeds even if enrichment would fail (invalid key)", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const result = await runSaveSession(tempDir, {
      agent: "claude-code",
      summary: "Test session",
      decisions: ["Use hybrid search"],
      files: ["src/lib/search.ts"],
    });

    // Should succeed — enrichment failures are caught
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/);
  });

  test("save-session succeeds even if event extraction throws", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const result = await runSaveSession(tempDir, {
      agent: "claude-code",
      summary: "Session that will have failed enrichment",
    });

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-claude-code-[a-f0-9]{6}$/);
  });
});
