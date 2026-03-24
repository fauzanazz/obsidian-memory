import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runTimeline, parseDuration } from "../../src/commands/timeline";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("parseDuration", () => {
  test("parses days", () => {
    const before = new Date();
    const result = parseDuration("7d");
    const after = new Date();
    before.setDate(before.getDate() - 7);
    after.setDate(after.getDate() - 7);
    const resultDate = new Date(result + "T12:00:00Z");
    expect(resultDate.getTime()).toBeGreaterThanOrEqual(after.setHours(0, 0, 0, 0));
    expect(resultDate.getTime()).toBeLessThanOrEqual(before.setHours(23, 59, 59, 999));
  });

  test("parses weeks", () => {
    const before = new Date();
    const result = parseDuration("2w");
    const after = new Date();
    before.setDate(before.getDate() - 14);
    after.setDate(after.getDate() - 14);
    const resultDate = new Date(result + "T12:00:00Z");
    expect(resultDate.getTime()).toBeGreaterThanOrEqual(after.setHours(0, 0, 0, 0));
    expect(resultDate.getTime()).toBeLessThanOrEqual(before.setHours(23, 59, 59, 999));
  });

  test("parses months", () => {
    const before = new Date();
    const result = parseDuration("1m");
    const after = new Date();
    before.setDate(1);
    before.setMonth(before.getMonth() - 1);
    after.setDate(1);
    after.setMonth(after.getMonth() - 1);
    const resultDate = new Date(result + "T12:00:00Z");
    expect(resultDate.getTime()).toBeGreaterThanOrEqual(after.setHours(0, 0, 0, 0));
    expect(resultDate.getTime()).toBeLessThanOrEqual(before.setHours(23, 59, 59, 999));
  });

  test("throws on invalid format", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration");
    expect(() => parseDuration("7x")).toThrow("Invalid duration");
    expect(() => parseDuration("")).toThrow("Invalid duration");
  });
});

describe("timeline command", () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
    vaultPath = join(tempDir, "vault");
    await mkdir(join(vaultPath, "Memory", "Projects", "my-app"), { recursive: true });
    // Write a Memory/Index.md so resolveVaultPath can find it
    await mkdir(join(vaultPath, "Memory"), { recursive: true });
    await writeFile(join(vaultPath, "Memory", "Index.md"), "# Index\n");

    await writeConfig(tempDir, {
      vault: "TestVault",
      project: "my-app",
      agents: ["claude-code"],
      vaultPath,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("returns message when no events exist", async () => {
    const output = await runTimeline(tempDir, { last: "7d" });
    expect(output).toContain("No events found");
    expect(output).toContain("my-app");
  });

  test("reads events from jsonl file", async () => {
    const today = new Date().toISOString().split("T")[0];
    const events = [
      { date: today, subject: "auth module", action: "implemented", object: "for user login", files: ["src/auth.ts"], aliases: ["authentication"], source: "", extracted_at: new Date().toISOString() },
      { date: today, subject: "JWT tokens", action: "configured", object: "with refresh rotation", files: [], aliases: ["token setup"], source: "Memory/Sessions/my-app/session1.md", extracted_at: new Date().toISOString() },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, {});
    expect(output).toContain("# Timeline — my-app");
    expect(output).toContain("auth module");
    expect(output).toContain("JWT tokens");
    expect(output).toContain("src/auth.ts");
  });

  test("filters by --since date", async () => {
    const events = [
      { date: "2026-03-20", subject: "old feature", action: "added", object: "to system", files: [], aliases: [], source: "", extracted_at: "" },
      { date: "2026-03-25", subject: "new feature", action: "added", object: "to system", files: [], aliases: [], source: "", extracted_at: "" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, { since: "2026-03-24" });
    expect(output).toContain("new feature");
    expect(output).not.toContain("old feature");
  });

  test("filters by --until date", async () => {
    const events = [
      { date: "2026-03-20", subject: "old feature", action: "added", object: "to system", files: [], aliases: [], source: "", extracted_at: "" },
      { date: "2026-03-25", subject: "new feature", action: "added", object: "to system", files: [], aliases: [], source: "", extracted_at: "" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, { until: "2026-03-22" });
    expect(output).toContain("old feature");
    expect(output).not.toContain("new feature");
  });

  test("respects --limit", async () => {
    const today = new Date().toISOString().split("T")[0];
    const events = [
      { date: today, subject: "feature 1", action: "added", object: "to app", files: [], aliases: [], source: "", extracted_at: "" },
      { date: today, subject: "feature 2", action: "added", object: "to app", files: [], aliases: [], source: "", extracted_at: "" },
      { date: today, subject: "feature 3", action: "added", object: "to app", files: [], aliases: [], source: "", extracted_at: "" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Projects", "my-app", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, { limit: 2 });
    expect(output).toContain("feature 1");
    expect(output).toContain("feature 2");
    expect(output).not.toContain("feature 3");
  });

  test("throws when no config found", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
    try {
      await expect(runTimeline(emptyDir, {})).rejects.toThrow("No .obsidian-memory.json found");
    } finally {
      await rm(emptyDir, { recursive: true });
    }
  });
});
