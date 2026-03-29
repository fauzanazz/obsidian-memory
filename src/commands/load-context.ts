import { findConfig, openStore, getEmbeddingsPath } from "../lib/config";
import { expandQuery } from "../lib/query-expander";
import { hybridSearch } from "../lib/retrieval";
import { loadEmbeddingsFile } from "../lib/embeddings-bin";
import { embedQuery } from "../lib/embeddings";
import type { MemoryStore } from "../lib/store";
export type LoadContextTier = "minimal" | "default" | "focus" | "full" | "task";

export interface LoadContextOptions {
  tier?: LoadContextTier;
  focus?: string;
  taskDescription?: string;
  includeConventions?: boolean;
  includeDecisions?: boolean;
  includeSessions?: number;
}

type LoadContextDefaults = Required<Omit<LoadContextOptions, "focus" | "taskDescription">>;

const DEFAULTS: LoadContextDefaults = {
  tier: "default",
  includeConventions: true,
  includeDecisions: true,
  includeSessions: 3,
};

export async function runLoadContext(
  cwd: string,
  options?: LoadContextOptions,
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  if (opts.focus) opts.tier = "focus";

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory config found. Run `obsidian-memory init` first.",
    );
  }

  const store = openStore(found.dir, found.config);
  try {
    const project = found.config.project;
    const sections: string[] = [];

    // Tier 1: Always loaded
    loadTier1(store, project, sections);

    if (opts.tier === "minimal") {
      return formatOutput(project, sections);
    }

    // Task-aware tier
    if (opts.tier === "task" && opts.taskDescription) {
      await loadTaskAware(store, found.dir, project, opts.taskDescription, sections, opts);
      return formatOutput(project, sections);
    }

    // Tier 2: Compact indexes
    loadTier2(store, sections, opts);

    if (opts.tier === "default") {
      return formatOutput(project, sections);
    }

    // Tier 3 (focus mode): keyword-matched sessions and events
    if (opts.tier === "focus" && opts.focus) {
      loadFocused(store, sections, opts.focus);
      return formatOutput(project, sections);
    }

    // Full mode: everything
    loadFull(store, sections, opts);
    return formatOutput(project, sections);
  } finally {
    store.close();
  }
}

function formatOutput(project: string, sections: string[]): string {
  if (sections.length === 0) {
    return "# Memory Context\n\n_No memory found for this project._";
  }
  return `# Memory Context — ${project}\n\n` + sections.join("\n\n---\n\n");
}

// ── Tier 1: Always loaded (~500 tokens) ──────────────────────

function loadTier1(
  store: MemoryStore,
  project: string,
  sections: string[],
): void {
  sections.push(`## Project\n\n**${project}**`);

  // Last session's summary + next steps + blockers
  const recent = store.listSessions({ limit: 1, archived: false });
  if (recent.length > 0) {
    const last = recent[0];
    const parts: string[] = [];
    parts.push(`**Last session** (${last.date}, ${last.agent}): ${last.summary}`);

    if (last.blockers.length > 0) {
      parts.push(`**Blockers:**\n${last.blockers.map((b) => `- ${b}`).join("\n")}`);
    }
    if (last.nextSteps.length > 0) {
      parts.push(`**Pending next steps:**\n${last.nextSteps.map((n) => `- ${n}`).join("\n")}`);
    }
    sections.push("## Continuity\n\n" + parts.join("\n\n"));
  }
}

// ── Tier 2: Compact indexes (~2000 tokens) ───────────────────

function loadTier2(
  store: MemoryStore,
  sections: string[],
  opts: LoadContextDefaults,
): void {
  // Feature index
  const features = store.listFeatures();
  if (features.length > 0) {
    const featureLines = features.map(
      (f) => `- **${f.slug}**: ${f.title} [${f.status}]`,
    );
    sections.push("## Features\n\n" + featureLines.join("\n"));
  }

  // Decision index
  if (opts.includeDecisions) {
    const decisions = store.listDecisions();
    if (decisions.length > 0) {
      const decisionLines = decisions.map(
        (d) => `- ADR-${String(d.adrNumber).padStart(3, "0")}: ${d.title} [${d.status}]`,
      );
      sections.push("## Decisions\n\n" + decisionLines.join("\n"));
    }
  }

  // Recent sessions (one-line summaries)
  if (opts.includeSessions > 0) {
    const sessions = store.listSessions({
      limit: opts.includeSessions,
      archived: false,
    });
    if (sessions.length > 0) {
      const sessionLines = sessions.map(
        (s) => `- ${s.id}: ${truncate(s.summary, 120)}`,
      );
      sections.push("## Recent Sessions\n\n" + sessionLines.join("\n"));
    }
  }
}

// ── Focus loader: keyword-filtered deep content ──────────────

function loadFocused(
  store: MemoryStore,
  sections: string[],
  keyword: string,
): void {
  // Search sessions by keyword
  const sessionResults = store.searchSessionsFTS(keyword, 10);

  // Search events by keyword
  const eventResults = store.searchEventsFTS(keyword, undefined, 10);

  if (sessionResults.length === 0 && eventResults.length === 0) {
    sections.push(`## Focus: "${keyword}"\n\n_No matching notes found._`);
    return;
  }

  const focusedSections: string[] = [];

  for (const result of sessionResults) {
    const session = store.getSession(result.id);
    if (!session) continue;
    focusedSections.push(`### ${session.id}\n\n${session.content}`);
  }

  if (eventResults.length > 0) {
    const eventLines = eventResults.map(
      (e) => `- **${e.subject}** ${e.action} ${e.object} (${e.date})`,
    );
    focusedSections.push(`### Matching Events\n\n${eventLines.join("\n")}`);
  }

  sections.push(
    `## Focus: "${keyword}" (${sessionResults.length} sessions, ${eventResults.length} events)\n\n` +
      focusedSections.join("\n\n---\n\n"),
  );
}

// ── Full loader: everything ──────────────────────────────────

function loadFull(
  store: MemoryStore,
  sections: string[],
  opts: LoadContextDefaults,
): void {
  // Replace tier 2 session summaries with full content
  if (opts.includeSessions > 0) {
    const sessions = store.listSessions({
      limit: opts.includeSessions,
      archived: false,
    });
    const sessionContent = sessions
      .map((s) => s.content)
      .filter(Boolean);

    if (sessionContent.length > 0) {
      // Replace the existing "Recent Sessions" section
      const sessIdx = sections.findIndex((s) => s.startsWith("## Recent Sessions"));
      const fullSection = "## Recent Sessions\n\n" + sessionContent.join("\n\n---\n\n");
      if (sessIdx !== -1) {
        sections[sessIdx] = fullSection;
      } else {
        sections.push(fullSection);
      }
    }
  }
}

// ── Task-aware tier: dynamic retrieval ───────────────────────

async function loadTaskAware(
  store: MemoryStore,
  configDir: string,
  _project: string,
  taskDescription: string,
  sections: string[],
  opts: LoadContextDefaults,
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Expand query (LLM-powered if available)
  const expanded = await expandQuery(taskDescription, apiKey);

  // Load embeddings + embed query if available
  const embPath = getEmbeddingsPath(configDir);
  const embIndex = await loadEmbeddingsFile(embPath);
  let queryVector: Float32Array | null = null;
  if (apiKey && embIndex) {
    try {
      const vec = await embedQuery(taskDescription, apiKey);
      if (vec.length > 0) queryVector = new Float32Array(vec);
    } catch { /* keyword only */ }
  }

  // Search events
  const eventResults = store.searchEventsFTS(
    expanded.terms.join(" OR "),
    expanded.timeframe,
    10,
  );

  if (eventResults.length > 0) {
    const eventLines = eventResults.map(
      (e) => `- **${e.subject}** ${e.action} ${e.object} (${e.date})`,
    );
    sections.push(`## Relevant Events\n\n${eventLines.join("\n")}`);
  }

  // Hybrid search for sessions
  const results = hybridSearch(store, expanded, embIndex, queryVector, {
    limit: 5,
    target: "sessions",
  });

  // Also include sessions from matched events
  const sessionIds = new Set(results.map((r) => r.id));
  for (const event of eventResults.slice(0, 5)) {
    if (event.sessionId && !sessionIds.has(event.sessionId)) {
      sessionIds.add(event.sessionId);
    }
  }

  // Load session content
  const sessionSections: string[] = [];
  for (const id of sessionIds) {
    const session = store.getSession(id);
    if (!session) continue;
    const parts: string[] = [`### ${session.id}`];
    parts.push(session.summary);
    if (session.decisions.length > 0) {
      parts.push(`**Decisions:** ${session.decisions.join("; ")}`);
    }
    sessionSections.push(parts.join("\n"));
  }

  if (sessionSections.length > 0) {
    sections.push(
      `## Relevant Sessions (${sessionSections.length} found)\n\n` +
        sessionSections.join("\n\n---\n\n"),
    );
  }

  // Decisions
  if (opts.includeDecisions) {
    const decisions = store.listDecisions();
    if (decisions.length > 0) {
      const decisionLines = decisions.map(
        (d) => `- ADR-${String(d.adrNumber).padStart(3, "0")}: ${d.title} [${d.status}]`,
      );
      sections.push("## Decisions\n\n" + decisionLines.join("\n"));
    }
  }

  // Task framing
  sections.unshift(
    `## Task Context\n\n**Task:** ${taskDescription}\n**Retrieval focus:** ${expanded.terms.join(", ")}`,
  );
}

// ── Helpers ──────────────────────────────────────────────────

export function extractSummary(content: string): string {
  const stripped = content.replace(/^---[\s\S]*?---\n*/, "");
  const noH1 = stripped.replace(/^# .+\n*/, "");
  const lines = noH1.split("\n");
  const paragraphLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) break;
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    if (trimmed.startsWith("## ")) {
      if (inParagraph) break;
      continue;
    }
    paragraphLines.push(trimmed);
    inParagraph = true;
  }

  return paragraphLines.join("\n") || "_No summary available._";
}

export function extractProgressCompact(content: string): string | null {
  const currentState = extractSection(content, "Current State");
  const blockers = extractSection(content, "Blockers");

  const parts: string[] = [];
  if (currentState?.trim()) parts.push("**Current state:**\n" + currentState.trim());
  if (blockers?.trim()) parts.push("**Blockers:**\n" + blockers.trim());

  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function extractSection(
  content: string,
  heading: string,
): string | null {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`);
  const match = content.match(regex);
  return match ? match[1] : null;
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
