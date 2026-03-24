import { join, dirname } from "path";
import { appendFile, mkdir } from "fs/promises";
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

export function buildExtractionPrompt(input: ExtractionInput): string {
  const replacements: Record<string, string> = {
    "{DATE}": input.date,
    "{SUMMARY}": input.summary,
    "{FILES}": input.files?.join(", ") || "none listed",
    "{DECISIONS}": input.decisions?.join("; ") || "none listed",
  };

  return EXTRACTION_PROMPT.replace(
    /\{DATE\}|\{SUMMARY\}|\{FILES\}|\{DECISIONS\}/g,
    (token) => replacements[token],
  );
}

export async function extractEvents(
  input: ExtractionInput,
  llmConfig?: LLMConfig,
): Promise<ProjectEvent[]> {
  // Graceful degradation: return empty when API key is missing
  const apiKeyEnv = llmConfig?.apiKeyEnv ?? "GEMINI_API_KEY";
  if (!process.env[apiKeyEnv]) {
    return [];
  }

  const prompt = buildExtractionPrompt(input);

  let raw: unknown;
  try {
    raw = await callLLMJson<unknown>(prompt, llmConfig);
  } catch {
    return [];
  }

  if (!Array.isArray(raw)) return [];

  const now = new Date().toISOString();

  return raw
    .filter((e: unknown): e is Record<string, unknown> =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as Record<string, unknown>).subject === "string" &&
      typeof (e as Record<string, unknown>).action === "string" &&
      typeof (e as Record<string, unknown>).object === "string"
    )
    .slice(0, 5) // cap at 5 events per session
    .map((e) => ({
      date: input.date,
      subject: e.subject as string,
      action: e.action as string,
      object: e.object as string,
      files: Array.isArray(e.files) ? (e.files as string[]) : [],
      aliases: Array.isArray(e.aliases) ? (e.aliases as string[]).slice(0, 3) : [],
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

export async function appendEvents(
  vaultPath: string,
  project: string,
  events: ProjectEvent[],
): Promise<void> {
  if (events.length === 0) return;

  const filePath = getEventsPath(vaultPath, project);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";

  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, lines, "utf-8");
}

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

// ---------------------------------------------------------------------------
// Search with relevance scoring
// ---------------------------------------------------------------------------

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
