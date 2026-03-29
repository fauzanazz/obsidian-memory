import { findConfig, openStore } from "../lib/config";
import { distillSessions } from "../lib/distiller";
import type { Session, LLMConfig } from "../lib/types";

export interface ConsolidateOptions {
  daysThreshold?: number;
  auto?: boolean;
  distill?: boolean;
}

export interface ConsolidateResult {
  sessionsFound: number;
  monthsProcessed: number;
  message: string;
}

export async function runConsolidate(
  cwd: string,
  options?: ConsolidateOptions,
): Promise<ConsolidateResult> {
  const threshold = options?.daysThreshold ?? 30;

  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const project = found.config.project;

  const oldSessions = store.getSessionsForConsolidation(threshold);

  if (oldSessions.length === 0) {
    store.close();
    return {
      sessionsFound: 0,
      monthsProcessed: 0,
      message: `No sessions older than ${threshold} days found to consolidate.`,
    };
  }

  // Group by month
  const byMonth = new Map<string, Session[]>();
  for (const session of oldSessions) {
    const month = session.date.slice(0, 7);
    const group = byMonth.get(month) ?? [];
    group.push(session);
    byMonth.set(month, group);
  }

  // LLM-powered distillation
  if (options?.distill) {
    const llmConfig: LLMConfig | undefined = found.config.llm;
    const apiKeyEnv = llmConfig?.apiKeyEnv ?? "GEMINI_API_KEY";

    if (!process.env[apiKeyEnv]) {
      console.log(`[consolidate] LLM key (${apiKeyEnv}) not set, falling back to summary-only mode.`);
    } else {
      // Load existing features and decisions for context
      const features = store.listFeatures();
      const decisions = store.listDecisions();
      const featureIndex = features.map((f) => `- ${f.slug}: ${f.title} [${f.status}]`).join("\n");
      const decisionIndex = decisions.map((d) => `- ADR-${String(d.adrNumber).padStart(3, "0")}: ${d.title}`).join("\n");

      for (const [_month, sessions] of byMonth) {
        const sessionData = sessions.map((s) => ({
          path: s.id,
          content: s.content,
          date: s.date,
        }));

        try {
          const distillation = await distillSessions(
            sessionData,
            "", // project context (not stored in SQLite yet)
            "", // progress
            featureIndex,
            decisionIndex,
            llmConfig,
          );

          // Create new decisions from distillation
          for (const decision of distillation.newDecisions) {
            try {
              store.insertDecision({
                project,
                title: decision.title,
                context: decision.context,
                decision: decision.decision,
                consequences: decision.consequences,
              });
            } catch { /* may already exist */ }
          }

          // Create new features from distillation
          for (const feature of distillation.newFeatures) {
            try {
              store.insertFeature({
                project,
                slug: feature.slug,
                title: feature.title,
                summary: feature.summary,
                status: feature.status,
              });
            } catch { /* may already exist */ }
          }
          // Archive sessions only after successful distillation
          store.archiveSessions(sessions.map((s) => s.id));
        } catch (err) {
          console.error(`[consolidate] Distillation failed for month ${_month}, skipping archive: ${err instanceof Error ? err.message : err}`);
        }
      }

      store.close();
      return {
        sessionsFound: oldSessions.length,
        monthsProcessed: byMonth.size,
        message: `Distilled ${oldSessions.length} sessions across ${byMonth.size} month(s).`,
      };
    }
  }

  // Auto mode: archive without LLM
  if (options?.auto || options?.distill) {
    store.archiveSessions(oldSessions.map((s) => s.id));
    store.close();
    return {
      sessionsFound: oldSessions.length,
      monthsProcessed: byMonth.size,
      message: `Archived ${oldSessions.length} sessions across ${byMonth.size} month(s).`,
    };
  }

  store.close();
  return {
    sessionsFound: oldSessions.length,
    monthsProcessed: byMonth.size,
    message: `Found ${oldSessions.length} sessions older than ${threshold} days across ${byMonth.size} month(s). Run with --auto to consolidate.`,
  };
}
