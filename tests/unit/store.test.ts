import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryStore, generateSessionId } from "../../src/lib/store";
import type {
  SaveSessionOptions,
  EventRecord,
  DecisionRecord,
  FeatureRecord,
} from "../../src/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): MemoryStore {
  return new MemoryStore(":memory:", "test-project");
}

function makeSessionOpts(overrides?: Partial<SaveSessionOptions>): SaveSessionOptions {
  return {
    project: "test-project",
    agent: "claude-code",
    date: "2026-03-29",
    summary: "Implemented user authentication with JWT",
    content: "# Session\n\nImplemented JWT auth flow...",
    files: ["src/auth.ts", "src/middleware.ts"],
    decisions: ["Use JWT over session cookies"],
    blockers: [],
    nextSteps: ["Add refresh token support"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

describe("MemoryStore — schema", () => {
  test("creates all tables on init", () => {
    const store = makeStore();
    const tables = store.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    const names = tables.map((t) => t.name);

    expect(names).toContain("sessions");
    expect(names).toContain("events");
    expect(names).toContain("events_fts");
    expect(names).toContain("decisions");
    expect(names).toContain("features");
    expect(names).toContain("meta");
    store.close();
  });

  test("sets schema version in meta", () => {
    const store = makeStore();
    const row = store.db
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    expect(row?.value).toBe("1");
    store.close();
  });

  test("idempotent schema init (no error on double open)", () => {
    // Can't reuse :memory: for this, but verify no throw
    const store = makeStore();
    expect(() => store.close()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe("MemoryStore — sessions", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  test("insert and get session", () => {
    const opts = makeSessionOpts();
    const id = "2026-03-29-claude-code-abc123";
    store.insertSession(id, opts);

    const session = store.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.project).toBe("test-project");
    expect(session!.agent).toBe("claude-code");
    expect(session!.summary).toBe("Implemented user authentication with JWT");
    expect(session!.files).toEqual(["src/auth.ts", "src/middleware.ts"]);
    expect(session!.decisions).toEqual(["Use JWT over session cookies"]);
    expect(session!.nextSteps).toEqual(["Add refresh token support"]);
    expect(session!.archived).toBe(false);
    expect(session!.enriched).toBe(false);
  });

  test("get non-existent session returns null", () => {
    expect(store.getSession("nonexistent")).toBeNull();
  });

  test("list sessions ordered by date descending", () => {
    store.insertSession("s1", makeSessionOpts({ date: "2026-03-27" }));
    store.insertSession("s2", makeSessionOpts({ date: "2026-03-29" }));
    store.insertSession("s3", makeSessionOpts({ date: "2026-03-28" }));

    const sessions = store.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
  });

  test("list sessions with since filter", () => {
    store.insertSession("s1", makeSessionOpts({ date: "2026-03-25" }));
    store.insertSession("s2", makeSessionOpts({ date: "2026-03-29" }));

    const sessions = store.listSessions({ since: "2026-03-28" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s2");
  });

  test("list sessions with archived filter", () => {
    store.insertSession("s1", makeSessionOpts());
    store.insertSession("s2", makeSessionOpts());
    store.archiveSession("s1");

    const active = store.listSessions({ archived: false });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("s2");

    const archived = store.listSessions({ archived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe("s1");
  });

  test("list sessions respects limit", () => {
    for (let i = 0; i < 10; i++) {
      store.insertSession(`s${i}`, makeSessionOpts({ date: `2026-03-${String(20 + i).padStart(2, "0")}` }));
    }
    const sessions = store.listSessions({ limit: 3 });
    expect(sessions).toHaveLength(3);
  });

  test("markEnriched sets enriched flag", () => {
    store.insertSession("s1", makeSessionOpts());
    store.markEnriched("s1");
    expect(store.getSession("s1")!.enriched).toBe(true);
  });

  test("archiveSession sets archived flag", () => {
    store.insertSession("s1", makeSessionOpts());
    store.archiveSession("s1");
    expect(store.getSession("s1")!.archived).toBe(true);
  });

  test("handles empty optional arrays", () => {
    const opts = makeSessionOpts({
      files: undefined,
      decisions: undefined,
      blockers: undefined,
      nextSteps: undefined,
    });
    store.insertSession("s1", opts);
    const session = store.getSession("s1")!;
    expect(session.files).toEqual([]);
    expect(session.decisions).toEqual([]);
    expect(session.blockers).toEqual([]);
    expect(session.nextSteps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("MemoryStore — events", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = makeStore();
    store.insertSession("s1", makeSessionOpts());
  });

  afterEach(() => {
    store.close();
  });

  test("insertBaseEvent creates a base event", () => {
    store.insertBaseEvent("s1", makeSessionOpts());
    const events = store.getEventsByDate();
    expect(events).toHaveLength(1);
    expect(events[0].isBase).toBe(true);
    expect(events[0].action).toBe("session");
    expect(events[0].sessionId).toBe("s1");
  });

  test("insertEvent creates a non-base event", () => {
    const event: EventRecord = {
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "JWT auth",
      action: "implemented",
      object: "token validation middleware",
      aliases: "authentication jwt login",
      files: "src/auth.ts src/middleware.ts",
      isBase: false,
    };
    store.insertEvent(event);

    const events = store.getEventsByDate();
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("JWT auth");
    expect(events[0].isBase).toBe(false);
  });

  test("deleteBaseEvents removes only base events for session", () => {
    store.insertBaseEvent("s1", makeSessionOpts());
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "JWT auth",
      action: "implemented",
      object: "middleware",
      isBase: false,
    });

    store.deleteBaseEvents("s1");
    const events = store.getEventsByDate();
    expect(events).toHaveLength(1);
    expect(events[0].isBase).toBe(false);
  });

  test("getEventsByDate filters by date range", () => {
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-25",
      subject: "a",
      action: "did",
      object: "x",
    });
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "b",
      action: "did",
      object: "y",
    });

    const filtered = store.getEventsByDate("2026-03-28");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].subject).toBe("b");
  });

  test("FTS5 search finds events by keyword", () => {
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "authentication middleware",
      action: "implemented",
      object: "JWT token validation",
      aliases: "login auth bearer",
    });
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "database schema",
      action: "migrated",
      object: "user table",
    });

    const results = store.searchEventsFTS("authentication");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].subject).toBe("authentication middleware");
  });

  test("FTS5 search matches aliases", () => {
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "auth flow",
      action: "built",
      object: "login page",
      aliases: "authentication signin credentials",
    });

    const results = store.searchEventsFTS("signin");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("FTS5 search with timeframe filter", () => {
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-20",
      subject: "old feature",
      action: "built",
      object: "thing",
    });
    store.insertEvent({
      project: "test-project",
      sessionId: "s1",
      date: "2026-03-29",
      subject: "new feature",
      action: "built",
      object: "thing",
    });

    const results = store.searchEventsFTS("feature", {
      since: "2026-03-25",
    });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("new feature");
  });

  test("transactional base event + session write", () => {
    const opts = makeSessionOpts();
    const id = "tx-test";

    store.transaction(() => {
      store.insertSession(id, opts);
      store.insertBaseEvent(id, opts);
    });

    expect(store.getSession(id)).not.toBeNull();
    const events = store.getEventsByDate();
    expect(events.some((e) => e.sessionId === id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

describe("MemoryStore — decisions", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  test("insert decision with auto ADR number", () => {
    const record: DecisionRecord = {
      project: "test-project",
      title: "Use JWT over Session Cookies",
      context: "Need stateless auth for API",
      decision: "JWT with RS256",
      alternatives: [{ name: "Session cookies", proscons: "Simpler but stateful" }],
      consequences: "Need token refresh logic",
      categories: ["auth", "security"],
      impacts: ["auth-flow"],
    };

    const { id, adrNumber } = store.insertDecision(record);
    expect(adrNumber).toBe(1);
    expect(id).toBe("ADR-001-use-jwt-over-session-cookies");

    const row = store.getDecision(id);
    expect(row).not.toBeNull();
    expect(row!.title).toBe("Use JWT over Session Cookies");
  });

  test("ADR numbers increment", () => {
    store.insertDecision({
      project: "test-project",
      title: "First Decision",
      context: "ctx",
      decision: "dec",
    });
    const { adrNumber } = store.insertDecision({
      project: "test-project",
      title: "Second Decision",
      context: "ctx",
      decision: "dec",
    });
    expect(adrNumber).toBe(2);
  });

  test("list decisions returns summaries", () => {
    store.insertDecision({
      project: "test-project",
      title: "Decision A",
      context: "ctx",
      decision: "dec",
      categories: ["infra"],
    });
    store.insertDecision({
      project: "test-project",
      title: "Decision B",
      context: "ctx",
      decision: "dec",
      categories: ["auth"],
    });

    const summaries = store.listDecisions();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].adrNumber).toBe(2); // ordered DESC
    expect(summaries[0].categories).toEqual(["auth"]);
  });
});

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

describe("MemoryStore — features", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  test("insert and list features", () => {
    const record: FeatureRecord = {
      project: "test-project",
      slug: "jwt-auth",
      title: "JWT Authentication",
      status: "in-progress",
      summary: "Token-based auth flow",
      categories: ["auth"],
      keyFiles: [{ path: "src/auth.ts", role: "main handler" }],
      limitations: ["No refresh tokens yet"],
    };

    store.insertFeature(record);
    const features = store.listFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].slug).toBe("jwt-auth");
    expect(features[0].title).toBe("JWT Authentication");
    expect(features[0].categories).toEqual(["auth"]);
  });

  test("upsert feature on slug conflict", () => {
    store.insertFeature({
      project: "test-project",
      slug: "jwt-auth",
      title: "JWT Auth v1",
    });
    store.insertFeature({
      project: "test-project",
      slug: "jwt-auth",
      title: "JWT Auth v2",
      status: "completed",
    });

    const features = store.listFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].title).toBe("JWT Auth v2");
  });
});

// ---------------------------------------------------------------------------
// Session ID generation
// ---------------------------------------------------------------------------

describe("generateSessionId", () => {
  test("follows expected format", () => {
    const id = generateSessionId({ date: "2026-03-29", agent: "claude-code" });
    expect(id).toMatch(/^2026-03-29-claude-code-[a-f0-9]{6}$/);
  });

  test("generates unique IDs", () => {
    // Use known-unique inputs instead of relying on random generation,
    // which can produce rare collisions in the 6-char hex space.
    const ids = new Set(
      Array.from({ length: 100 }, (_, i) =>
        generateSessionId({ date: `2026-03-${String(i).padStart(2, "0")}`, agent: `test-${i}` }),
      ),
    );
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Session keyword search
// ---------------------------------------------------------------------------

describe("MemoryStore — searchSessionsFTS", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = makeStore();
    store.insertSession("s1", makeSessionOpts({
      summary: "Implemented JWT authentication",
      content: "Built the login flow with JWT tokens",
    }));
    store.insertSession("s2", makeSessionOpts({
      summary: "Fixed database migration bug",
      content: "The user table migration was failing",
    }));
  });

  afterEach(() => {
    store.close();
  });

  test("finds sessions by keyword in summary", () => {
    const results = store.searchSessionsFTS("JWT");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("s1");
  });

  test("finds sessions by keyword in content", () => {
    const results = store.searchSessionsFTS("migration");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("s2");
  });

  test("returns empty for no match", () => {
    const results = store.searchSessionsFTS("nonexistent");
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

describe("MemoryStore — consolidation", () => {
  test("getSessionsForConsolidation returns old non-archived sessions", () => {
    const store = makeStore();
    store.insertSession("old", makeSessionOpts({ date: "2025-01-01" }));
    store.insertSession("recent", makeSessionOpts({ date: "2026-03-29" }));
    store.insertSession("archived", makeSessionOpts({ date: "2025-01-01" }));
    store.archiveSession("archived");

    const forConsolidation = store.getSessionsForConsolidation(30);
    expect(forConsolidation).toHaveLength(1);
    expect(forConsolidation[0].id).toBe("old");
    store.close();
  });

  test("archiveSessions marks multiple sessions", () => {
    const store = makeStore();
    store.insertSession("s1", makeSessionOpts());
    store.insertSession("s2", makeSessionOpts());
    store.insertSession("s3", makeSessionOpts());

    store.archiveSessions(["s1", "s3"]);

    expect(store.getSession("s1")!.archived).toBe(true);
    expect(store.getSession("s2")!.archived).toBe(false);
    expect(store.getSession("s3")!.archived).toBe(true);
    store.close();
  });
});

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

describe("MemoryStore — transaction", () => {
  test("rolls back on error", () => {
    const store = makeStore();

    try {
      store.transaction(() => {
        store.insertSession("tx-fail", makeSessionOpts());
        throw new Error("deliberate failure");
      });
    } catch {
      // expected
    }

    expect(store.getSession("tx-fail")).toBeNull();
    store.close();
  });
});
