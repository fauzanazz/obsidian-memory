import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runTimeline, parseDuration } from "../../src/commands/timeline";
import { writeConfig } from "../../src/lib/config";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("parseDuration", () => {
  test("parses days", () => {
    const result = parseDuration("7d");
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    expect(result).toBe(expected.toISOString().split("T")[0]);
  });

  test("parses weeks", () => {
    const result = parseDuration("2w");
    const expected = new Date();
    expected.setDate(expected.getDate() - 14);
    expect(result).toBe(expected.toISOString().split("T")[0]);
  });

  test("parses months", () => {
    const result = parseDuration("1m");
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 1);
    expect(result).toBe(expected.toISOString().split("T")[0]);
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
    await mkdir(join(vaultPath, "Memory", "Events"), { recursive: true });
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
      { date: today, type: "feature", summary: "Added auth module", tags: ["auth"] },
      { date: today, type: "decision", summary: "Use JWT tokens", source: "Memory/Sessions/my-app/session1.md" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, {});
    expect(output).toContain("# Timeline — my-app");
    expect(output).toContain("Added auth module");
    expect(output).toContain("Use JWT tokens");
    expect(output).toContain("[auth]");
  });

  test("filters by --since date", async () => {
    const events = [
      { date: "2026-03-20", type: "feature", summary: "Old event" },
      { date: "2026-03-25", type: "feature", summary: "New event" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, { since: "2026-03-24" });
    expect(output).toContain("New event");
    expect(output).not.toContain("Old event");
  });

  test("filters by --until date", async () => {
    const events = [
      { date: "2026-03-20", type: "feature", summary: "Old event" },
      { date: "2026-03-25", type: "feature", summary: "New event" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, { until: "2026-03-22" });
    expect(output).toContain("Old event");
    expect(output).not.toContain("New event");
  });

  test("respects --limit", async () => {
    const today = new Date().toISOString().split("T")[0];
    const events = [
      { date: today, type: "feature", summary: "Event 1" },
      { date: today, type: "feature", summary: "Event 2" },
      { date: today, type: "feature", summary: "Event 3" },
    ];
    await writeFile(
      join(vaultPath, "Memory", "Events", "my-app.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const output = await runTimeline(tempDir, { limit: 2 });
    // Should only have 2 events
    const eventMatches = output.match(/\*\*feature\*\*/g);
    expect(eventMatches?.length).toBe(2);
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
