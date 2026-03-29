/**
 * MemoryStore — SQLite-backed persistence for obsidian-memory v2.
 *
 * Owns the SQLite connection and provides all CRUD operations for sessions,
 * events (temporal index with FTS5), decisions, and features.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash } from "crypto";
import type {
  SaveSessionOptions,
  Session,
  EventRecord,
  EventResult,
  DecisionRecord,
  DecisionRow,
  DecisionSummary,
  FeatureRecord,
  FeatureRow,
  FeatureSummary,
  TimeRange,
} from "./types";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  agent       TEXT NOT NULL,
  date        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  content     TEXT NOT NULL,
  files       TEXT DEFAULT '[]',
  decisions   TEXT DEFAULT '[]',
  blockers    TEXT DEFAULT '[]',
  next_steps  TEXT DEFAULT '[]',
  archived    INTEGER DEFAULT 0,
  enriched    INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_project_date ON sessions(project, date DESC);

CREATE TABLE IF NOT EXISTS events (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  project     TEXT NOT NULL,
  session_id  TEXT REFERENCES sessions(id),
  date        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  action      TEXT NOT NULL,
  object      TEXT NOT NULL,
  aliases     TEXT DEFAULT '',
  files       TEXT DEFAULT '',
  is_base     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_project_date ON events(project, date DESC);

CREATE TABLE IF NOT EXISTS decisions (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  adr_number  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT DEFAULT 'accepted',
  context     TEXT NOT NULL,
  decision    TEXT NOT NULL,
  alternatives TEXT DEFAULT '[]',
  consequences TEXT DEFAULT '',
  categories  TEXT DEFAULT '[]',
  impacts     TEXT DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS features (
  slug        TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT DEFAULT 'in-progress',
  summary     TEXT DEFAULT '',
  categories  TEXT DEFAULT '[]',
  key_files   TEXT DEFAULT '[]',
  limitations TEXT DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  subject, action, object, aliases, files,
  content='events',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
`;

const TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, subject, action, object, aliases, files)
  VALUES (new.rowid, new.subject, new.action, new.object, new.aliases, new.files);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, subject, action, object, aliases, files)
  VALUES ('delete', old.rowid, old.subject, old.action, old.object, old.aliases, old.files);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, subject, action, object, aliases, files)
  VALUES ('delete', old.rowid, old.subject, old.action, old.object, old.aliases, old.files);
  INSERT INTO events_fts(rowid, subject, action, object, aliases, files)
  VALUES (new.rowid, new.subject, new.action, new.object, new.aliases, new.files);
END;
`;

// ---------------------------------------------------------------------------
// Session ID generation
// ---------------------------------------------------------------------------

export function generateSessionId(opts: {
  date: string;
  agent: string;
}): string {
  const hash = createHash("sha256")
    .update(`${opts.date}-${opts.agent}-${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 6);
  return `${opts.date}-${opts.agent}-${hash}`;
}

// ---------------------------------------------------------------------------
// Row ↔ Domain conversions
// ---------------------------------------------------------------------------

function sessionFromRow(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    project: row.project as string,
    agent: row.agent as string,
    date: row.date as string,
    summary: row.summary as string,
    content: row.content as string,
    files: JSON.parse((row.files as string) || "[]"),
    decisions: JSON.parse((row.decisions as string) || "[]"),
    blockers: JSON.parse((row.blockers as string) || "[]"),
    nextSteps: JSON.parse((row.next_steps as string) || "[]"),
    archived: (row.archived as number) === 1,
    enriched: (row.enriched as number) === 1,
    createdAt: row.created_at as string,
  };
}

function eventFromRow(row: Record<string, unknown>): EventResult {
  return {
    rowid: row.rowid as number,
    project: row.project as string,
    sessionId: row.session_id as string,
    date: row.date as string,
    subject: row.subject as string,
    action: row.action as string,
    object: row.object as string,
    aliases: (row.aliases as string) || "",
    files: (row.files as string) || "",
    isBase: (row.is_base as number) === 1,
    createdAt: row.created_at as string,
  };
}

function decisionSummaryFromRow(row: DecisionRow): DecisionSummary {
  return {
    id: row.id,
    adrNumber: row.adr_number,
    title: row.title,
    status: row.status,
    categories: JSON.parse(row.categories || "[]"),
  };
}

function featureSummaryFromRow(row: FeatureRow): FeatureSummary {
  return {
    slug: row.slug,
    title: row.title,
    status: row.status,
    categories: JSON.parse(row.categories || "[]"),
  };
}

// ---------------------------------------------------------------------------
// ADR helpers
// ---------------------------------------------------------------------------

function titleToSlug(title: string, maxLength = 50): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  readonly db: Database;
  readonly project: string;

  constructor(dbPath: string, project: string) {
    this.db = new Database(dbPath);
    this.project = project;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");

    this.db.exec(SCHEMA_SQL);
    this.db.exec(FTS_SQL);
    this.db.exec(TRIGGERS_SQL);

    // Set schema version if not set
    const existing = this.db
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    if (!existing) {
      this.db
        .query("INSERT INTO meta (key, value) VALUES ('schema_version', ?)")
        .run(String(SCHEMA_VERSION));
    }
  }

  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  insertSession(id: string, opts: SaveSessionOptions): void {
    this.db
      .query(
        `INSERT INTO sessions (id, project, agent, date, summary, content, files, decisions, blockers, next_steps)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        opts.project,
        opts.agent,
        opts.date,
        opts.summary,
        opts.content,
        JSON.stringify(opts.files ?? []),
        JSON.stringify(opts.decisions ?? []),
        JSON.stringify(opts.blockers ?? []),
        JSON.stringify(opts.nextSteps ?? []),
      );
  }

  getSession(id: string): Session | null {
    const row = this.db
      .query<Record<string, unknown>, [string]>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    return row ? sessionFromRow(row) : null;
  }

  listSessions(opts?: {
    limit?: number;
    since?: string;
    archived?: boolean;
  }): Session[] {
    const conditions: string[] = ["project = ?"];
    const params: SQLQueryBindings[] =[this.project];

    if (opts?.since) {
      conditions.push("date >= ?");
      params.push(opts.since);
    }
    if (opts?.archived !== undefined) {
      conditions.push("archived = ?");
      params.push(opts.archived ? 1 : 0);
    }

    const limit = opts?.limit ?? 50;
    const sql = `SELECT * FROM sessions WHERE ${conditions.join(" AND ")} ORDER BY date DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db
      .query<Record<string, unknown>, SQLQueryBindings[]>(sql)
      .all(...params);
    return rows.map(sessionFromRow);
  }

  markEnriched(id: string): void {
    this.db.query("UPDATE sessions SET enriched = 1 WHERE id = ?").run(id);
  }

  archiveSession(id: string): void {
    this.db.query("UPDATE sessions SET archived = 1 WHERE id = ?").run(id);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  insertBaseEvent(sessionId: string, opts: SaveSessionOptions): void {
    this.db
      .query(
        `INSERT INTO events (project, session_id, date, subject, action, object, files, is_base)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        opts.project,
        sessionId,
        opts.date,
        opts.project,
        "session",
        opts.summary.slice(0, 200),
        (opts.files ?? []).join(" "),
      );
  }

  insertEvent(event: EventRecord): void {
    this.db
      .query(
        `INSERT INTO events (project, session_id, date, subject, action, object, aliases, files, is_base)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.project,
        event.sessionId,
        event.date,
        event.subject,
        event.action,
        event.object,
        event.aliases ?? "",
        event.files ?? "",
        event.isBase ? 1 : 0,
      );
  }

  deleteBaseEvents(sessionId: string): void {
    this.db
      .query("DELETE FROM events WHERE session_id = ? AND is_base = 1")
      .run(sessionId);
  }

  searchEventsFTS(
    query: string,
    timeframe?: TimeRange,
    limit?: number,
  ): EventResult[] {
    const maxResults = limit ?? 20;

    // Build FTS5 match query
    let sql: string;
    const params: SQLQueryBindings[] =[];

    if (timeframe?.since || timeframe?.until) {
      // Join with events table for date filtering
      const dateConditions: string[] = [];
      if (timeframe.since) {
        dateConditions.push("e.date >= ?");
        params.push(timeframe.since);
      }
      if (timeframe.until) {
        dateConditions.push("e.date <= ?");
        params.push(timeframe.until);
      }
      params.push(this.project);
      params.push(query);
      params.push(maxResults);

      sql = `
        SELECT e.*, rank
        FROM events e
        JOIN events_fts fts ON e.rowid = fts.rowid
        WHERE ${dateConditions.join(" AND ")}
          AND e.project = ?
          AND events_fts MATCH ?
        ORDER BY rank
        LIMIT ?`;
    } else {
      params.push(this.project, query, maxResults);
      sql = `
        SELECT e.*, rank
        FROM events e
        JOIN events_fts fts ON e.rowid = fts.rowid
        WHERE e.project = ?
          AND events_fts MATCH ?
        ORDER BY rank
        LIMIT ?`;
    }

    const rows = this.db
      .query<Record<string, unknown>, SQLQueryBindings[]>(sql)
      .all(...params);

    return rows.map((row) => ({
      ...eventFromRow(row),
      rank: row.rank as number | undefined,
    }));
  }

  getEventsByDate(since?: string, until?: string, project?: string): EventResult[] {
    const conditions: string[] = ["project = ?"];
    const params: SQLQueryBindings[] =[project ?? this.project];

    if (since) {
      conditions.push("date >= ?");
      params.push(since);
    }
    if (until) {
      conditions.push("date <= ?");
      params.push(until);
    }

    const sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY date DESC`;
    const rows = this.db
      .query<Record<string, unknown>, SQLQueryBindings[]>(sql)
      .all(...params);
    return rows.map(eventFromRow);
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  getNextADRNumber(): number {
    const row = this.db
      .query<{ max_num: number | null }, [string]>(
        "SELECT MAX(adr_number) as max_num FROM decisions WHERE project = ?",
      )
      .get(this.project);
    return (row?.max_num ?? 0) + 1;
  }

  insertDecision(record: DecisionRecord): { id: string; adrNumber: number } {
    const adrNumber = this.getNextADRNumber();
    const slug = titleToSlug(record.title);
    const id = `ADR-${String(adrNumber).padStart(3, "0")}-${slug}`;

    this.db
      .query(
        `INSERT INTO decisions (id, project, adr_number, title, status, context, decision, alternatives, consequences, categories, impacts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        record.project,
        adrNumber,
        record.title,
        record.status ?? "accepted",
        record.context,
        record.decision,
        JSON.stringify(record.alternatives ?? []),
        record.consequences ?? "",
        JSON.stringify(record.categories ?? []),
        JSON.stringify(record.impacts ?? []),
      );

    return { id, adrNumber };
  }

  getDecision(id: string): DecisionRow | null {
    return this.db
      .query<DecisionRow, [string]>("SELECT * FROM decisions WHERE id = ?")
      .get(id);
  }

  getDecisionByADRNumber(adrNumber: number): DecisionRow | null {
    return this.db
      .query<DecisionRow, [string, number]>(
        "SELECT * FROM decisions WHERE project = ? AND adr_number = ?",
      )
      .get(this.project, adrNumber);
  }

  updateDecisionStatus(id: string, status: string): void {
    this.db
      .query("UPDATE decisions SET status = ? WHERE id = ?")
      .run(status, id);
  }

  listDecisions(): DecisionSummary[] {
    const rows = this.db
      .query<DecisionRow, [string]>(
        "SELECT * FROM decisions WHERE project = ? ORDER BY adr_number DESC",
      )
      .all(this.project);
    return rows.map(decisionSummaryFromRow);
  }

  // -------------------------------------------------------------------------
  // Features
  // -------------------------------------------------------------------------

  insertFeature(record: FeatureRecord): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO features (slug, project, title, status, summary, categories, key_files, limitations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.slug,
        record.project,
        record.title,
        record.status ?? "in-progress",
        record.summary ?? "",
        JSON.stringify(record.categories ?? []),
        JSON.stringify(record.keyFiles ?? []),
        JSON.stringify(record.limitations ?? []),
      );
  }

  getFeature(slug: string): FeatureRow | null {
    return this.db
      .query<FeatureRow, [string]>("SELECT * FROM features WHERE slug = ?")
      .get(slug);
  }

  listFeatures(): FeatureSummary[] {
    const rows = this.db
      .query<FeatureRow, [string]>(
        "SELECT * FROM features WHERE project = ? ORDER BY title",
      )
      .all(this.project);
    return rows.map(featureSummaryFromRow);
  }

  // -------------------------------------------------------------------------
  // Counts (lightweight alternatives to full-table loads)
  // -------------------------------------------------------------------------

  countSessions(): number {
    const row = this.db
      .query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM sessions WHERE project = ?")
      .get(this.project);
    return row?.cnt ?? 0;
  }

  countEvents(): number {
    const row = this.db
      .query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM events WHERE project = ?")
      .get(this.project);
    return row?.cnt ?? 0;
  }

  countDecisions(): number {
    const row = this.db
      .query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM decisions WHERE project = ?")
      .get(this.project);
    return row?.cnt ?? 0;
  }

  countFeatures(): number {
    const row = this.db
      .query<{ cnt: number }, [string]>("SELECT COUNT(*) as cnt FROM features WHERE project = ?")
      .get(this.project);
    return row?.cnt ?? 0;
  }

  // -------------------------------------------------------------------------
  // FTS5 search across sessions
  // -------------------------------------------------------------------------

  searchSessionsFTS(query: string, limit?: number): Array<{ id: string; rank: number }> {
    // Sessions don't have their own FTS table — use LIKE for now.
    // Full-text on sessions will use vector search in the hybrid pipeline.
    const maxResults = limit ?? 20;
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const conditions = terms.map(() => "(summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
    const params: SQLQueryBindings[] =[];
    for (const term of terms) {
      const escaped = term.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
      const pattern = `%${escaped}%`;
      params.push(pattern, pattern);
    }
    params.push(this.project, maxResults);

    const sql = `
      SELECT id FROM sessions
      WHERE (${conditions.join(" OR ")})
        AND project = ?
      ORDER BY date DESC
      LIMIT ?`;

    const rows = this.db
      .query<{ id: string }, SQLQueryBindings[]>(sql)
      .all(...params);

    // Assign synthetic ranks based on position
    return rows.map((row, i) => ({ id: row.id, rank: i + 1 }));
  }

  // -------------------------------------------------------------------------
  // Consolidation
  // -------------------------------------------------------------------------

  getSessionsForConsolidation(daysThreshold: number): Session[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysThreshold);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const rows = this.db
      .query<Record<string, unknown>, [string, string]>(
        `SELECT * FROM sessions
         WHERE project = ? AND date < ? AND archived = 0
         ORDER BY date ASC`,
      )
      .all(this.project, cutoffStr);
    return rows.map(sessionFromRow);
  }

  archiveSessions(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .query(`UPDATE sessions SET archived = 1 WHERE id IN (${placeholders})`)
      .run(...ids);
  }

  // -------------------------------------------------------------------------
  // Transaction helper
  // -------------------------------------------------------------------------

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
