import { findConfig, openStore, getEmbeddingsPath } from "../lib/config";
import { enrichSession } from "../lib/enricher";
import { extractEvents, type ExtractionInput } from "../lib/event-extractor";
import { loadEmbeddingsFile, saveEmbeddingsFile, addEntry, contentHash, emptyIndex } from "../lib/embeddings-bin";
import { embedTexts } from "../lib/embeddings";
import type { EventRecord } from "../lib/types";

export interface MaintainOptions {
  enrich?: boolean;
  session?: string;
}

export interface MaintainResult {
  sessionsEnriched: number;
  featuresCreated: string[];
  decisionsCreated: string[];
  contextDriftWarnings: string[];
  message: string;
}

export async function runMaintain(
  cwd: string,
  options: MaintainOptions,
): Promise<MaintainResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const project = found.config.project;
  const llm = found.config.llm;

  const result: MaintainResult = {
    sessionsEnriched: 0,
    featuresCreated: [],
    decisionsCreated: [],
    contextDriftWarnings: [],
    message: "",
  };

  if (!options.enrich) {
    store.close();
    result.message = "No maintenance action specified. Use --enrich.";
    return result;
  }

  // Find unenriched sessions
  let sessions;
  if (options.session) {
    const s = store.getSession(options.session);
    sessions = s && s.project === project && !s.enriched ? [s] : [];
  } else {
    sessions = store.listSessions({ archived: false }).filter((s) => !s.enriched);
  }

  if (sessions.length === 0) {
    store.close();
    result.message = "No unenriched sessions found.";
    return result;
  }

  const apiKeyEnv = llm?.apiKeyEnv ?? "GEMINI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    store.close();
    result.message = `LLM key (${apiKeyEnv}) not set. Cannot enrich sessions.`;
    return result;
  }

  // Load feature/decision indexes for enrichment context
  const features = store.listFeatures();
  const decisions = store.listDecisions();
  const featureIndex = features.map((f) => `- ${f.slug}: ${f.title}`).join("\n") || "_No features yet._";
  const decisionIndex = decisions.map((d) => `- ADR-${String(d.adrNumber).padStart(3, "0")}: ${d.title}`).join("\n") || "_No decisions yet._";

  // Process up to 3 sessions per run
  for (const session of sessions.slice(0, 3)) {
    try {
      // 1. Enrich session (extract features/decisions/cross-links)
      const enrichment = await enrichSession(session.content, featureIndex, decisionIndex, llm);

      // 2. Create extracted features
      for (const feature of enrichment.features) {
        try {
          store.insertFeature({
            project,
            slug: feature.slug,
            title: feature.title,
            summary: feature.summary,
            status: feature.status,
            categories: feature.categories,
            keyFiles: feature.keyFiles,
          });
          result.featuresCreated.push(feature.slug);
        } catch { /* may already exist */ }
      }

      // 3. Create extracted decisions
      for (const decision of enrichment.decisions) {
        try {
          const { id } = store.insertDecision({
            project,
            title: decision.title,
            context: decision.context,
            decision: decision.decision,
            categories: decision.categories,
            impacts: decision.impacts,
            alternatives: decision.alternatives,
            consequences: decision.consequences,
          });
          result.decisionsCreated.push(id);
        } catch { /* may already exist */ }
      }

      // 4. Extract events if not already enriched
      try {
        const input: ExtractionInput = {
          date: session.date,
          summary: session.summary,
          files: session.files,
          decisions: session.decisions,
          sessionPath: session.id,
        };
        const events = await extractEvents(input, llm);
        if (events.length > 0) {
          store.transaction(() => {
            store.deleteBaseEvents(session.id);
            for (const event of events) {
              const record: EventRecord = {
                project,
                sessionId: session.id,
                date: session.date,
                subject: event.subject,
                action: event.action,
                object: event.object,
                aliases: event.aliases.join(" "),
                files: event.files.join(" "),
                isBase: false,
              };
              store.insertEvent(record);
            }
          });
        }
      } catch { /* event extraction is best-effort */ }

      // 5. Generate embedding
      try {
        const embPath = getEmbeddingsPath(found.dir);
        let index = await loadEmbeddingsFile(embPath) ?? emptyIndex();
        const [embedding] = await embedTexts([session.content], apiKey);
        if (embedding?.length > 0) {
          index = addEntry(index, session.id, contentHash(session.content), new Float32Array(embedding));
          await saveEmbeddingsFile(embPath, index);
        }
      } catch { /* embedding is best-effort */ }

      // 6. Track context drift
      if (enrichment.contextDrift) {
        result.contextDriftWarnings.push(enrichment.contextDrift);
      }

      store.markEnriched(session.id);
      result.sessionsEnriched++;
    } catch (err) {
      console.error(`Failed to enrich ${session.id}: ${err}`);
    }
  }

  store.close();
  result.message = formatMaintainResult(result);
  return result;
}

function formatMaintainResult(result: MaintainResult): string {
  const lines: string[] = [];
  lines.push(`Enriched ${result.sessionsEnriched} session(s).`);
  if (result.featuresCreated.length > 0) {
    lines.push(`  Features created: ${result.featuresCreated.join(", ")}`);
  }
  if (result.decisionsCreated.length > 0) {
    lines.push(`  Decisions created: ${result.decisionsCreated.join(", ")}`);
  }
  if (result.contextDriftWarnings.length > 0) {
    lines.push(`\nContext drift detected:`);
    for (const w of result.contextDriftWarnings) {
      lines.push(`  - ${w}`);
    }
  }
  return lines.join("\n");
}
