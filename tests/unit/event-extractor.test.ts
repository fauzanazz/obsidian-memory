import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildExtractionPrompt,
  extractEvents,
  appendEvents,
  readEvents,
  searchEvents,
  formatEventTimeline,
  getEventsPath,
  type ProjectEvent,
  type ExtractionInput,
} from "../../src/lib/event-extractor";

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleEvents: ProjectEvent[] = [
  {
    date: "2026-03-24",
    subject: "WebSocket handler",
    action: "implemented",
    object: "iterate endpoint",
    files: ["src/ws.ts"],
    aliases: ["added iterate ws handler", "ws iterate endpoint"],
    source: "Memory/Sessions/test/2026-03-24-session.md",
    extracted_at: "2026-03-24T12:00:00Z",
  },
  {
    date: "2026-03-23",
    subject: "auth middleware",
    action: "refactored",
    object: "JWT validation",
    files: ["src/auth.ts"],
    aliases: ["updated jwt auth", "auth token validation refactor"],
    source: "Memory/Sessions/test/2026-03-23-session.md",
    extracted_at: "2026-03-23T12:00:00Z",
  },
  {
    date: "2026-03-24",
    subject: "database schema",
    action: "migrated",
    object: "users table",
    files: ["migrations/001.sql"],
    aliases: ["user table migration", "schema update for users"],
    source: "Memory/Sessions/test/2026-03-24-session.md",
    extracted_at: "2026-03-24T12:30:00Z",
  },
];

const sampleInput: ExtractionInput = {
  date: "2026-03-24",
  summary: "Implemented WebSocket handler for iterate endpoint and migrated users table",
  files: ["src/ws.ts", "migrations/001.sql"],
  decisions: ["Use binary protocol for WS frames"],
  sessionPath: "Memory/Sessions/test/2026-03-24-session.md",
};

// ---------------------------------------------------------------------------
// buildExtractionPrompt
// ---------------------------------------------------------------------------

describe("buildExtractionPrompt", () => {
  test("includes session date in prompt", () => {
    const prompt = buildExtractionPrompt(sampleInput);
    expect(prompt).toContain("2026-03-24");
  });

  test("includes summary in prompt", () => {
    const prompt = buildExtractionPrompt(sampleInput);
    expect(prompt).toContain("Implemented WebSocket handler");
  });

  test("includes files in prompt", () => {
    const prompt = buildExtractionPrompt(sampleInput);
    expect(prompt).toContain("src/ws.ts");
    expect(prompt).toContain("migrations/001.sql");
  });

  test("includes decisions in prompt", () => {
    const prompt = buildExtractionPrompt(sampleInput);
    expect(prompt).toContain("Use binary protocol for WS frames");
  });

  test("uses placeholder for missing files", () => {
    const prompt = buildExtractionPrompt({
      ...sampleInput,
      files: undefined,
    });
    expect(prompt).toContain("none listed");
  });

  test("uses placeholder for missing decisions", () => {
    const prompt = buildExtractionPrompt({
      ...sampleInput,
      decisions: undefined,
    });
    expect(prompt).toContain("none listed");
  });

  test("includes extraction rules", () => {
    const prompt = buildExtractionPrompt(sampleInput);
    expect(prompt).toContain("Extract 1-5 events");
    expect(prompt).toContain("aliases");
    expect(prompt).toContain("DIFFERENT vocabulary");
  });
});

// ---------------------------------------------------------------------------
// extractEvents
// ---------------------------------------------------------------------------

describe("extractEvents", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  test("returns empty array when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await extractEvents(sampleInput);
    expect(result).toEqual([]);
  });

  test("returns empty array when custom API key is missing", async () => {
    delete process.env.MY_KEY;
    const result = await extractEvents(sampleInput, {
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnv: "MY_KEY",
    });
    expect(result).toEqual([]);
  });

  test("extracts events from LLM response", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const llmResponse = [
      {
        subject: "WebSocket handler",
        action: "implemented",
        object: "for iterate endpoint",
        files: ["src/ws.ts"],
        aliases: ["added ws iterate handler", "websocket iterate setup"],
      },
    ];

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(llmResponse) }] } },
          ],
        }),
        { status: 200 },
      );

    const result = await extractEvents(sampleInput);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("WebSocket handler");
    expect(result[0].action).toBe("implemented");
    expect(result[0].object).toBe("for iterate endpoint");
    expect(result[0].date).toBe("2026-03-24");
    expect(result[0].source).toBe(sampleInput.sessionPath);
    expect(result[0].files).toEqual(["src/ws.ts"]);
    expect(result[0].aliases).toHaveLength(2);
    expect(result[0].extracted_at).toBeTruthy();
  });

  test("caps events at 5 per session", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const llmResponse = Array.from({ length: 8 }, (_, i) => ({
      subject: `entity-${i}`,
      action: "created",
      object: "test",
      files: [],
      aliases: [],
    }));

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(llmResponse) }] } },
          ],
        }),
        { status: 200 },
      );

    const result = await extractEvents(sampleInput);
    expect(result).toHaveLength(5);
  });

  test("caps aliases at 3 per event", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const llmResponse = [
      {
        subject: "test",
        action: "created",
        object: "thing",
        files: [],
        aliases: ["a1", "a2", "a3", "a4", "a5"],
      },
    ];

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(llmResponse) }] } },
          ],
        }),
        { status: 200 },
      );

    const result = await extractEvents(sampleInput);
    expect(result[0].aliases).toHaveLength(3);
  });

  test("filters out events with missing required fields", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const llmResponse = [
      { subject: "valid", action: "created", object: "thing", files: [], aliases: [] },
      { subject: "missing-action", object: "thing", files: [], aliases: [] },
      { action: "created", object: "thing", files: [], aliases: [] },
      { subject: "valid2", action: "fixed", object: "bug", files: [], aliases: [] },
    ];

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(llmResponse) }] } },
          ],
        }),
        { status: 200 },
      );

    const result = await extractEvents(sampleInput);
    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe("valid");
    expect(result[1].subject).toBe("valid2");
  });

  test("returns empty on non-array LLM response", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ not: "an array" }) }] } },
          ],
        }),
        { status: 200 },
      );

    const result = await extractEvents(sampleInput);
    expect(result).toEqual([]);
  });

  test("returns empty on LLM error", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    globalThis.fetch = async () =>
      new Response("Internal Server Error", { status: 500 });

    const result = await extractEvents(sampleInput);
    expect(result).toEqual([]);
  });

  test("handles missing files/aliases arrays gracefully", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const llmResponse = [
      { subject: "test", action: "created", object: "thing" },
    ];

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(llmResponse) }] } },
          ],
        }),
        { status: 200 },
      );

    const result = await extractEvents(sampleInput);
    expect(result[0].files).toEqual([]);
    expect(result[0].aliases).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchEvents
// ---------------------------------------------------------------------------

describe("searchEvents", () => {
  test("finds events by subject", () => {
    const results = searchEvents(sampleEvents, "WebSocket");
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("WebSocket handler");
  });

  test("finds events by alias", () => {
    const results = searchEvents(sampleEvents, "jwt auth");
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("auth middleware");
  });

  test("returns empty for no matches", () => {
    const results = searchEvents(sampleEvents, "graphql subscription");
    expect(results).toHaveLength(0);
  });

  test("ranks by number of matching terms", () => {
    const results = searchEvents(sampleEvents, "auth jwt validation");
    expect(results[0].subject).toBe("auth middleware");
  });

  test("returns all events for empty query", () => {
    const results = searchEvents(sampleEvents, "");
    expect(results).toHaveLength(sampleEvents.length);
  });

  test("case-insensitive matching", () => {
    const results = searchEvents(sampleEvents, "websocket");
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("WebSocket handler");
  });

  test("matches action field", () => {
    const results = searchEvents(sampleEvents, "migrated");
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("database schema");
  });

  test("matches object field", () => {
    const results = searchEvents(sampleEvents, "users table");
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("database schema");
  });
});

// ---------------------------------------------------------------------------
// formatEventTimeline
// ---------------------------------------------------------------------------

describe("formatEventTimeline", () => {
  test("groups events by date, newest first", () => {
    const output = formatEventTimeline(sampleEvents);
    expect(output).toContain("## 2026-03-24");
    expect(output).toContain("## 2026-03-23");
    expect(output.indexOf("2026-03-24")).toBeLessThan(output.indexOf("2026-03-23"));
  });

  test("returns message for empty events", () => {
    expect(formatEventTimeline([])).toBe("No events found.");
  });

  test("includes subject, action, and object", () => {
    const output = formatEventTimeline([sampleEvents[0]]);
    expect(output).toContain("**WebSocket handler**");
    expect(output).toContain("implemented");
    expect(output).toContain("iterate endpoint");
  });

  test("includes file paths in backticks", () => {
    const output = formatEventTimeline([sampleEvents[0]]);
    expect(output).toContain("`src/ws.ts`");
  });

  test("handles events with no files", () => {
    const noFileEvent: ProjectEvent = {
      ...sampleEvents[0],
      files: [],
    };
    const output = formatEventTimeline([noFileEvent]);
    expect(output).not.toContain("(`");
  });
});

// ---------------------------------------------------------------------------
// getEventsPath
// ---------------------------------------------------------------------------

describe("getEventsPath", () => {
  test("returns correct path", () => {
    const path = getEventsPath("/vault", "my-project");
    expect(path).toBe(join("/vault", "Memory", "Projects", "my-project", "events.jsonl"));
  });
});

// ---------------------------------------------------------------------------
// appendEvents + readEvents (file I/O tests)
// ---------------------------------------------------------------------------

describe("appendEvents and readEvents", () => {
  let tmpDir: string;
  const project = "test-project";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "event-extractor-test-"));
    // Create the directory structure
    const dir = join(tmpDir, "Memory", "Projects", project);
    await Bun.write(join(dir, ".gitkeep"), "");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("appendEvents creates file and writes events", async () => {
    await appendEvents(tmpDir, project, [sampleEvents[0]]);

    const filePath = getEventsPath(tmpDir, project);
    const content = await Bun.file(filePath).text();
    const parsed = JSON.parse(content.trim());
    expect(parsed.subject).toBe("WebSocket handler");
  });

  test("appendEvents appends to existing file", async () => {
    await appendEvents(tmpDir, project, [sampleEvents[0]]);
    await appendEvents(tmpDir, project, [sampleEvents[1]]);

    const filePath = getEventsPath(tmpDir, project);
    const content = await Bun.file(filePath).text();
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  test("appendEvents skips when events array is empty", async () => {
    await appendEvents(tmpDir, project, []);

    const filePath = getEventsPath(tmpDir, project);
    const exists = await Bun.file(filePath).exists();
    expect(exists).toBe(false);
  });

  test("readEvents returns empty for non-existent file", async () => {
    const events = await readEvents(tmpDir, project);
    expect(events).toEqual([]);
  });

  test("readEvents returns all events", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project);
    expect(events).toHaveLength(3);
  });

  test("readEvents filters by since date", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, { since: "2026-03-24" });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.date >= "2026-03-24")).toBe(true);
  });

  test("readEvents filters by until date", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, { until: "2026-03-23" });
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-03-23");
  });

  test("readEvents filters by date range", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, {
      since: "2026-03-23",
      until: "2026-03-23",
    });
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("auth middleware");
  });

  test("readEvents filters by keyword", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, { keyword: "websocket" });
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("WebSocket handler");
  });

  test("readEvents keyword matches files", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, { keyword: "auth.ts" });
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("auth middleware");
  });

  test("readEvents keyword matches aliases", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, { keyword: "schema update" });
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("database schema");
  });

  test("readEvents skips malformed lines", async () => {
    const filePath = getEventsPath(tmpDir, project);
    const validLine = JSON.stringify(sampleEvents[0]);
    await Bun.write(filePath, `${validLine}\nnot valid json\n${validLine}\n`);

    const events = await readEvents(tmpDir, project);
    expect(events).toHaveLength(2);
  });

  test("readEvents combines date and keyword filters", async () => {
    await appendEvents(tmpDir, project, sampleEvents);

    const events = await readEvents(tmpDir, project, {
      since: "2026-03-24",
      keyword: "database",
    });
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("database schema");
  });
});
