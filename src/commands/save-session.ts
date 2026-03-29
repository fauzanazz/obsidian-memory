import { findConfig, openStore, getEmbeddingsPath } from "../lib/config";
import { generateSessionId } from "../lib/store";
import { extractEvents, type ExtractionInput } from "../lib/event-extractor";
import { loadEmbeddingsFile, saveEmbeddingsFile, addEntry, contentHash, emptyIndex } from "../lib/embeddings-bin";
import { embedTexts } from "../lib/embeddings";
import type { EventRecord } from "../lib/types";

export interface SaveSessionOptions {
  agent: string;
  summary: string;
  decisions?: string[];
  files?: string[];
  blockers?: string[];
  nextSteps?: string[];
}

const ENRICHMENT_TIMEOUT_MS = 10_000;

export async function runSaveSession(
  cwd: string,
  options: SaveSessionOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory config found. Run `obsidian-memory init` first.",
    );
  }

  const { project, llm } = found.config;
  const store = openStore(found.dir, found.config);

  const date = new Date().toISOString().split("T")[0];
  const sessionId = generateSessionId({ date, agent: options.agent });

  const content = buildSessionContent(options, project, date);

  // Sync: write session + base event in same transaction
  store.transaction(() => {
    store.insertSession(sessionId, {
      project,
      agent: options.agent,
      date,
      summary: options.summary,
      content,
      files: options.files,
      decisions: options.decisions,
      blockers: options.blockers,
      nextSteps: options.nextSteps,
    });
    store.insertBaseEvent(sessionId, {
      project,
      agent: options.agent,
      date,
      summary: options.summary,
      content,
      files: options.files,
    });
  });

  // Async: LLM enrichment with timeout
  const apiKey = process.env[llm?.apiKeyEnv ?? "GEMINI_API_KEY"];
  if (apiKey) {
    const enrichPromise = enrichSessionAsync(
      found.dir,
      store,
      sessionId,
      { date, summary: options.summary, files: options.files, decisions: options.decisions },
      content,
      apiKey,
      llm,
    ).catch(() => {});
    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(resolve, ENRICHMENT_TIMEOUT_MS),
    );
    await Promise.race([enrichPromise, timeoutPromise]);
    await enrichPromise.finally(() => store.close());
  } else {
    store.close();
  }

  return sessionId;
}

async function enrichSessionAsync(
  configDir: string,
  store: import("../lib/store").MemoryStore,
  sessionId: string,
  opts: { date: string; summary: string; files?: string[]; decisions?: string[] },
  content: string,
  apiKey: string,
  llmConfig?: import("../lib/types").LLMConfig,
): Promise<void> {
  // 1. Extract SVO events via Gemini Flash
  try {
    const input: ExtractionInput = {
      date: opts.date,
      summary: opts.summary,
      files: opts.files,
      decisions: opts.decisions,
      sessionPath: sessionId,
    };
    const events = await extractEvents(input, llmConfig);

    if (events.length > 0) {
      // Atomic swap: delete base event, insert enriched events
      store.transaction(() => {
        store.deleteBaseEvents(sessionId);
        for (const event of events) {
          const record: EventRecord = {
            project: store.project,
            sessionId,
            date: opts.date,
            subject: event.subject,
            action: event.action,
            object: event.object,
            aliases: event.aliases.join(" "),
            files: event.files.join(" "),
            isBase: false,
          };
          store.insertEvent(record);
        }
        store.markEnriched(sessionId);
      });
    }
  } catch (err) {
    console.error(`[enrich] Event extraction failed: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Generate embedding for the session content
  try {
    const embPath = getEmbeddingsPath(configDir);
    let index = await loadEmbeddingsFile(embPath) ?? emptyIndex();
    const [embedding] = await embedTexts([content], apiKey);
    if (embedding && embedding.length > 0) {
      index = addEntry(index, sessionId, contentHash(content), new Float32Array(embedding));
      await saveEmbeddingsFile(embPath, index);
    }
  } catch (err) {
    console.error(`[enrich] Embedding failed: ${err instanceof Error ? err.message : err}`);
  }
}

function buildSessionContent(
  opts: SaveSessionOptions,
  project: string,
  date: string,
): string {
  const lines: string[] = [];
  lines.push(`# Session — ${date}`);
  lines.push("");
  lines.push(`**Agent:** ${opts.agent}`);
  lines.push(`**Project:** ${project}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(opts.summary);
  lines.push("");

  if (opts.decisions?.length) {
    lines.push("## Decisions Made");
    lines.push("");
    for (const d of opts.decisions) lines.push(`- ${d}`);
    lines.push("");
  }

  if (opts.files?.length) {
    lines.push("## Files Modified");
    lines.push("");
    for (const f of opts.files) lines.push(`- \`${f}\``);
    lines.push("");
  }

  if (opts.blockers?.length) {
    lines.push("## Blockers");
    lines.push("");
    for (const b of opts.blockers) lines.push(`- ${b}`);
    lines.push("");
  }

  if (opts.nextSteps?.length) {
    lines.push("## Next Steps");
    lines.push("");
    for (const n of opts.nextSteps) lines.push(`- ${n}`);
    lines.push("");
  }

  return lines.join("\n");
}
