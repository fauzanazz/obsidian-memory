/**
 * Tests for v2 command migrations.
 *
 * These test the command logic directly using in-memory SQLite stores,
 * bypassing the CLI parsing layer and filesystem config resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryStore, generateSessionId } from "../../src/lib/store";
import { formatEventTimeline, parseDuration } from "../../src/commands/timeline";
import { formatSearchResults } from "../../src/commands/search";
import type { RankedResult } from "../../src/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): MemoryStore {
  return new MemoryStore(":memory:", "test-project");
}

function seedStore(store: MemoryStore): void {
  // Session 1: auth work
  store.insertSession("s-auth", {
    project: "test-project",
    agent: "claude-code",
    date: "2026-03-29",
    summary: "Implemented JWT authentication middleware",
    content: "# Session\n\nBuilt JWT auth flow with RS256 signing.",
    files: ["src/auth.ts", "src/middleware.ts"],
    decisions: ["Use JWT over session cookies"],
    blockers: [],
    nextSteps: ["Add refresh token support"],
  });
  store.insertBaseEvent("s-auth", {
    project: "test-project",
    agent: "claude-code",
    date: "2026-03-29",
    summary: "Implemented JWT authentication middleware",
    content: "",
    files: ["src/auth.ts", "src/middleware.ts"],
  });
  store.insertEvent({
    project: "test-project",
    sessionId: "s-auth",
    date: "2026-03-29",
    subject: "JWT middleware",
    action: "implemented",
    object: "token validation",
    aliases: "authentication login bearer",
    isBase: false,
  });

  // Session 2: database work
  store.insertSession("s-db", {
    project: "test-project",
    agent: "cursor",
    date: "2026-03-28",
    summary: "Fixed database migration for user table",
    content: "# Session\n\nResolved schema conflict in user table migration.",
    files: ["migrations/001.sql"],
    decisions: [],
    blockers: ["Schema lock issue on staging"],
    nextSteps: ["Run migration on staging"],
  });
  store.insertBaseEvent("s-db", {
    project: "test-project",
    agent: "cursor",
    date: "2026-03-28",
    summary: "Fixed database migration for user table",
    content: "",
    files: ["migrations/001.sql"],
  });
  store.insertEvent({
    project: "test-project",
    sessionId: "s-db",
    date: "2026-03-28",
    subject: "user table",
    action: "migrated",
    object: "database schema",
    aliases: "db migration sql schema",
    isBase: false,
  });

  // Decision
  store.insertDecision({
    project: "test-project",
    title: "JWT over Session Cookies",
    context: "Need stateless auth",
    decision: "JWT with RS256",
    categories: ["auth"],
  });

  // Feature
  store.insertFeature({
    project: "test-project",
    slug: "jwt-auth",
    title: "JWT Authentication",
    status: "in-progress",
  });
}

// ---------------------------------------------------------------------------
// save-session: transactional guarantee
// ---------------------------------------------------------------------------

describe("save-session — transactional guarantee", () => {
  let store: MemoryStore;

  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  test("session + base event written in same transaction", () => {
    const id = generateSessionId({ date: "2026-03-29", agent: "test" });
    store.transaction(() => {
      store.insertSession(id, {
        project: "test-project",
        agent: "test",
        date: "2026-03-29",
        summary: "Test session",
        content: "content",
      });
      store.insertBaseEvent(id, {
        project: "test-project",
        agent: "test",
        date: "2026-03-29",
        summary: "Test session",
        content: "content",
      });
    });

    const session = store.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.summary).toBe("Test session");

    const events = store.getEventsByDate();
    const baseEvent = events.find((e) => e.sessionId === id && e.isBase);
    expect(baseEvent).toBeDefined();
  });

  test("enrichment replaces base event atomically", () => {
    const id = "enrich-test";
    store.insertSession(id, {
      project: "test-project",
      agent: "test",
      date: "2026-03-29",
      summary: "Test",
      content: "content",
    });
    store.insertBaseEvent(id, {
      project: "test-project",
      agent: "test",
      date: "2026-03-29",
      summary: "Test",
      content: "",
    });

    // Simulate enrichment
    store.transaction(() => {
      store.deleteBaseEvents(id);
      store.insertEvent({
        project: "test-project",
        sessionId: id,
        date: "2026-03-29",
        subject: "auth module",
        action: "refactored",
        object: "middleware chain",
        isBase: false,
      });
      store.markEnriched(id);
    });

    const events = store.getEventsByDate();
    const sessionEvents = events.filter((e) => e.sessionId === id);
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0].isBase).toBe(false);
    expect(sessionEvents[0].subject).toBe("auth module");

    expect(store.getSession(id)!.enriched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search: formatSearchResults
// ---------------------------------------------------------------------------

describe("search — formatSearchResults", () => {
  test("formats empty results", () => {
    const output = formatSearchResults([], "keyword");
    expect(output).toBe("No results found.");
  });

  test("formats session results", () => {
    const results: RankedResult[] = [
      {
        id: "s-auth",
        type: "session",
        score: 0.5,
        sources: ["keyword", "vector"],
        summary: "Implemented JWT authentication",
        date: "2026-03-29",
      },
    ];
    const output = formatSearchResults(results, "hybrid");
    expect(output).toContain("s-auth");
    expect(output).toContain("keyword+vector");
    expect(output).toContain("JWT authentication");
  });

  test("formats event results", () => {
    const results: RankedResult[] = [
      {
        id: "42",
        type: "event",
        score: 0.3,
        sources: ["keyword"],
        subject: "user table",
        action: "migrated",
        object: "schema",
        date: "2026-03-28",
      },
    ];
    const output = formatSearchResults(results, "keyword");
    expect(output).toContain("user table migrated schema");
  });
});

// ---------------------------------------------------------------------------
// query: event search + session linking
// ---------------------------------------------------------------------------

describe("query — event FTS5 + session linking", () => {
  let store: MemoryStore;

  beforeEach(() => { store = makeStore(); seedStore(store); });
  afterEach(() => { store.close(); });

  test("FTS5 finds events by keyword", () => {
    const events = store.searchEventsFTS("authentication");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.subject.includes("JWT"))).toBe(true);
  });

  test("events link back to sessions", () => {
    const events = store.searchEventsFTS("migration");
    expect(events.length).toBeGreaterThanOrEqual(1);
    const session = store.getSession(events[0].sessionId);
    expect(session).not.toBeNull();
    expect(session!.summary).toContain("database migration");
  });
});

// ---------------------------------------------------------------------------
// timeline: date filtering + formatting
// ---------------------------------------------------------------------------

describe("timeline — SQL date queries", () => {
  let store: MemoryStore;

  beforeEach(() => { store = makeStore(); seedStore(store); });
  afterEach(() => { store.close(); });

  test("getEventsByDate returns all events", () => {
    const events = store.getEventsByDate();
    // 2 base events + 2 enriched events
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test("getEventsByDate with since filter", () => {
    const events = store.getEventsByDate("2026-03-29");
    expect(events.every((e) => e.date >= "2026-03-29")).toBe(true);
  });

  test("formatEventTimeline groups by date", () => {
    const events = store.getEventsByDate();
    const output = formatEventTimeline(events);
    expect(output).toContain("## 2026-03-29");
    expect(output).toContain("## 2026-03-28");
  });

  test("formatEventTimeline handles empty", () => {
    const output = formatEventTimeline([]);
    expect(output).toBe("No events found.");
  });
});

describe("parseDuration", () => {
  test("parses days", () => {
    const result = parseDuration("7d");
    // Should be 7 days before today
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
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("rejects invalid format", () => {
    expect(() => parseDuration("abc")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// load-context: tier system
// ---------------------------------------------------------------------------

describe("load-context — tier system via MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => { store = makeStore(); seedStore(store); });
  afterEach(() => { store.close(); });

  test("tier 1 (minimal): last session + continuity", () => {
    const recent = store.listSessions({ limit: 1, archived: false });
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("s-auth"); // most recent by date
    expect(recent[0].nextSteps).toContain("Add refresh token support");
  });

  test("tier 2 (default): features + decisions + sessions", () => {
    const features = store.listFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].slug).toBe("jwt-auth");

    const decisions = store.listDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].title).toBe("JWT over Session Cookies");

    const sessions = store.listSessions({ limit: 3, archived: false });
    expect(sessions).toHaveLength(2);
  });

  test("tier 3 (focus): keyword search finds relevant sessions", () => {
    const results = store.searchSessionsFTS("JWT");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("s-auth");
  });

  test("tier 3 (focus): keyword search finds relevant events", () => {
    const results = store.searchEventsFTS("migration");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("tier 4 (full): session content available", () => {
    const sessions = store.listSessions({ limit: 3, archived: false });
    for (const s of sessions) {
      expect(s.content.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// get: session retrieval by ID
// ---------------------------------------------------------------------------

describe("get — session retrieval", () => {
  let store: MemoryStore;

  beforeEach(() => { store = makeStore(); seedStore(store); });
  afterEach(() => { store.close(); });

  test("retrieves session content by ID", () => {
    const session = store.getSession("s-auth");
    expect(session).not.toBeNull();
    expect(session!.content).toContain("JWT auth flow");
  });

  test("returns null for nonexistent ID", () => {
    expect(store.getSession("nonexistent")).toBeNull();
  });
});
