# Event Extraction Pipeline

## Context

obsidian-memory stores session summaries as raw markdown notes. There's no structured extraction of what happened, when, and to what. The enricher (`maintain --enrich`) extracts features and decisions, but not temporal events. You can't query "what changed in auth last week?" because events are buried in prose.

Inspired by the Chronos paper's "Event Calendar," this task creates an event extraction pipeline that extracts structured temporal events from session summaries at save-time, with lexical alias generation to improve keyword recall.

This module is a foundational library used by the session wiring (next wave) and temporal query commands (wave after). It has no CLI-facing changes — it's pure infrastructure.

## Requirements

- Extract structured events from a session note's summary + files + decisions using Gemini Flash
- Each event has: date, subject, action, object, files, aliases (2-3 paraphrases), source session path
- Store events in an append-only JSONL file at `Memory/Projects/{project}/events.jsonl`
- Read events from JSONL with optional date-range and keyword filters
- Generate 2-3 lexical aliases per event (Chronos technique for improving keyword recall)
- Graceful degradation: returns empty when GEMINI_API_KEY is missing
- No new npm dependencies

## Implementation

### 1. Create event extractor module

**File:** `src/lib/event-extractor.ts` (new)

```typescript
import { join } from "path";
import { callLLMJson } from "./llm";
import type { LLMConfig } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectEvent {
  date: string;            // ISO date (YYYY-MM-DD)
  subject: string;         // what entity was acted on
  action: string;          // what was done (past tense verb)
  object: string;          // additional context / target
  files: string[];         // files involved
  aliases: string[];       // 2-3 lexical paraphrases for keyword recall
  source: string;          // vault-relative path to source session note
  extracted_at: string;    // ISO 8601 timestamp
}

export interface ExtractionInput {
  date: string;            // session date (YYYY-MM-DD)
  summary: string;         // session summary text
  files?: string[];        // files modified
  decisions?: string[];    // decisions made
  sessionPath: string;     // vault-relative path to the session note
}

// ---------------------------------------------------------------------------
// LLM-powered extraction
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are a technical event extraction agent. Analyze this coding session summary and extract structured temporal events.

## Session
- **Date**: {DATE}
- **Summary**: {SUMMARY}
- **Files Modified**: {FILES}
- **Decisions**: {DECISIONS}

---

Extract events as a JSON array. Each event represents one distinct thing that happened:

[
  {
    "subject": "what entity was acted on (e.g., 'WebSocket handler', 'auth middleware', 'user table')",
    "action": "what was done, past tense (e.g., 'implemented', 'refactored', 'fixed', 'removed', 'configured')",
    "object": "additional context (e.g., 'for iterate endpoint', 'with JWT validation', 'in users API')",
    "files": ["relevant/file/paths"],
    "aliases": ["2-3 alternative phrasings of this event for keyword search"]
  }
]

Rules:
- Extract 1-5 events per session (only real, distinct actions)
- Each alias should use DIFFERENT vocabulary than the subject/action/object (for search recall)
- Aliases should be short phrases (3-8 words), not full sentences
- If the session just fixed a bug, that's one event. If it built a feature with 3 parts, that's 3 events.
- Only include files that are directly relevant to each event
- Return ONLY valid JSON array, no markdown fences`;

export async function extractEvents(
  input: ExtractionInput,
  llmConfig?: LLMConfig,
): Promise<ProjectEvent[]> {
  const prompt = EXTRACTION_PROMPT
    .replace("{DATE}", input.date)
    .replace("{SUMMARY}", input.summary)
    .replace("{FILES}", input.files?.join(", ") || "none listed")
    .replace("{DECISIONS}", input.decisions?.join("; ") || "none listed");

  const raw = await callLLMJson<Array<{
    subject: string;
    action: string;
    object: string;
    files: string[];
    aliases: string[];
  }>>(prompt, llmConfig);

  if (!Array.isArray(raw)) return [];

  const now = new Date().toISOString();

  return raw
    .filter((e) =>
      typeof e.subject === "string" &&
      typeof e.action === "string" &&
      typeof e.object === "string"
    )
    .slice(0, 5) // cap at 5 events per session
    .map((e) => ({
      date: input.date,
      subject: e.subject,
      action: e.action,
      object: e.object,
      files: Array.isArray(e.files) ? e.files : [],
      aliases: Array.isArray(e.aliases) ? e.aliases.slice(0, 3) : [],
      source: input.sessionPath,
      extracted_at: now,
    }));
}

// ---------------------------------------------------------------------------
// JSONL persistence
// ---------------------------------------------------------------------------

export function getEventsPath(vaultPath: string, project: string): string {
  return join(vaultPath, "Memory", "Projects", project, "events.jsonl");
}

/**
 * Append events to the project's events.jsonl file.
 */
export async function appendEvents(
  vaultPath: string,
  project: string,
  events: ProjectEvent[],
): Promise<void> {
  if (events.length === 0) return;

  const filePath = getEventsPath(vaultPath, project);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";

  const file = Bun.file(filePath);
  if (await file.exists()) {
    // Append to existing file
    const existing = await file.text();
    await Bun.write(filePath, existing + lines);
  } else {
    await Bun.write(filePath, lines);
  }
}

/**
 * Read all events from the project's events.jsonl file.
 * Optionally filter by date range and/or keyword.
 */
export async function readEvents(
  vaultPath: string,
  project: string,
  filters?: {
    since?: string;   // ISO date (inclusive)
    until?: string;   // ISO date (inclusive)
    keyword?: string; // search in subject, action, object, aliases
  },
): Promise<ProjectEvent[]> {
  const filePath = getEventsPath(vaultPath, project);
  const file = Bun.file(filePath);

  if (!(await file.exists())) return [];

  const text = await file.text();
  const events: ProjectEvent[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as ProjectEvent;
      events.push(event);
    } catch {
      // Skip malformed lines
    }
  }

  // Apply filters
  let filtered = events;

  if (filters?.since) {
    filtered = filtered.filter((e) => e.date >= filters.since!);
  }
  if (filters?.until) {
    filtered = filtered.filter((e) => e.date <= filters.until!);
  }
  if (filters?.keyword) {
    const kw = filters.keyword.toLowerCase();
    filtered = filtered.filter((e) => {
      const searchable = [
        e.subject, e.action, e.object,
        ...e.aliases,
        ...e.files,
      ].join(" ").toLowerCase();
      return searchable.includes(kw);
    });
  }

  return filtered;
}

/**
 * Search events by matching a query against subject, action, object, and aliases.
 * Returns events sorted by relevance (number of matching terms).
 */
export function searchEvents(
  events: ProjectEvent[],
  query: string,
): ProjectEvent[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return events;

  const scored = events.map((event) => {
    const searchable = [
      event.subject, event.action, event.object,
      ...event.aliases,
    ].join(" ").toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (searchable.includes(term)) score++;
    }

    return { event, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.event);
}

// ---------------------------------------------------------------------------
// Formatting (for CLI output)
// ---------------------------------------------------------------------------

export function formatEventTimeline(events: ProjectEvent[]): string {
  if (events.length === 0) return "No events found.";

  // Group by date
  const byDate = new Map<string, ProjectEvent[]>();
  for (const event of events) {
    const group = byDate.get(event.date) ?? [];
    group.push(event);
    byDate.set(event.date, group);
  }

  const lines: string[] = [];
  const sortedDates = Array.from(byDate.keys()).sort().reverse();

  for (const date of sortedDates) {
    lines.push(`## ${date}`);
    for (const event of byDate.get(date)!) {
      const filesStr = event.files.length > 0
        ? ` (${event.files.map((f) => "`" + f + "`").join(", ")})`
        : "";
      lines.push(`- **${event.subject}** ${event.action} ${event.object}${filesStr}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

## Testing Strategy

**File:** `tests/unit/event-extractor.test.ts` (new)

Test all pure functions (no LLM calls):

```typescript
import { describe, test, expect } from "bun:test";
import {
  readEvents, searchEvents, formatEventTimeline,
  type ProjectEvent,
} from "../../src/lib/event-extractor";

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
];

describe("searchEvents", () => {
  test("finds events by subject", () => {
    const results = searchEvents(sampleEvents, "WebSocket");
    expect(results.length).toBe(1);
    expect(results[0].subject).toBe("WebSocket handler");
  });

  test("finds events by alias", () => {
    const results = searchEvents(sampleEvents, "jwt auth");
    expect(results.length).toBe(1);
    expect(results[0].subject).toBe("auth middleware");
  });

  test("returns empty for no matches", () => {
    const results = searchEvents(sampleEvents, "database migration");
    expect(results.length).toBe(0);
  });

  test("ranks by number of matching terms", () => {
    const results = searchEvents(sampleEvents, "auth jwt validation");
    expect(results[0].subject).toBe("auth middleware");
  });
});

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
});
```

Also add tests for `appendEvents` and `readEvents` using temp files, and test `extractEvents` with mocked `callLLMJson`.

**Commands:**
```bash
bun test
bunx tsc --noEmit
```

## Out of Scope

- CLI command changes (this is a library module only)
- Wiring into `save-session` (next wave)
- Timeline/query CLI commands (wave 3)
- Backfilling old sessions (maintain --enrich can call extractEvents later)
- Event deduplication across sessions (each session's events are independent)
- Embedding events into the vector index (next wave)
