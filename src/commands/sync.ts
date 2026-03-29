import { join } from "path";
import { mkdir } from "fs/promises";
import { findConfig, openStore, resolveVaultPath } from "../lib/config";
import { sessionNote, featureNote, adrNote } from "../templates/note-templates";
import type { FeatureRow, DecisionRow } from "../lib/types";

export interface SyncOptions {
  vaultPath?: string;
}

export interface SyncResult {
  sessions: number;
  decisions: number;
  features: number;
  vaultPath: string;
}

export async function runSync(
  cwd: string,
  options?: SyncOptions,
): Promise<SyncResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const project = found.config.project;

  const vaultPath = options?.vaultPath ?? resolveVaultPath(found.config);
  if (!vaultPath) {
    store.close();
    throw new Error(
      "No vault path configured. Set vaultPath in config or pass --vault-path.",
    );
  }

  const result: SyncResult = { sessions: 0, decisions: 0, features: 0, vaultPath };

  // Ensure directories
  const sessionsDir = join(vaultPath, "Memory", "Sessions", project);
  const adrsDir = join(vaultPath, "Memory", "Projects", project, "ADRs");
  const featuresDir = join(vaultPath, "Memory", "Projects", project, "Features");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(adrsDir, { recursive: true });
  await mkdir(featuresDir, { recursive: true });

  // Export sessions
  const sessions = store.listSessions({ limit: 10000 });
  for (const session of sessions) {
    const content = sessionNote({
      agent: session.agent,
      project,
      date: session.date,
      summary: session.summary,
      decisions: session.decisions,
      files: session.files,
      blockers: session.blockers,
      nextSteps: session.nextSteps,
    });
    const filename = `${session.id}.md`;
    await Bun.write(join(sessionsDir, filename), content);
    result.sessions++;
  }

  // Export decisions
  const decisions = store.db
    .query<DecisionRow, [string]>("SELECT * FROM decisions WHERE project = ? ORDER BY adr_number", )
    .all(project);
  for (const d of decisions) {
    const num = String(d.adr_number).padStart(3, "0");
    const alternatives = JSON.parse(d.alternatives || "[]") as Array<{ name: string; proscons: string }>;
    const content = adrNote({
      project,
      adrNumber: d.adr_number,
      title: d.title,
      date: d.created_at.slice(0, 10),
      status: d.status as "accepted" | "proposed" | "superseded" | "deprecated",
      categories: JSON.parse(d.categories || "[]"),
      impacts: JSON.parse(d.impacts || "[]"),
      context: d.context,
      decision: d.decision,
      alternatives,
      consequences: d.consequences,
    });
    const slug = d.id.replace(/^ADR-\d+-/, "");
    await Bun.write(join(adrsDir, `ADR-${num}-${slug}.md`), content);
    result.decisions++;
  }

  // Export features
  const features = store.db
    .query<FeatureRow, [string]>("SELECT * FROM features WHERE project = ? ORDER BY title")
    .all(project);
  for (const f of features) {
    const content = featureNote({
      project,
      slug: f.slug,
      title: f.title,
      date: f.created_at.slice(0, 10),
      status: f.status as "draft" | "in-progress" | "completed" | "deprecated",
      summary: f.summary || undefined,
      categories: JSON.parse(f.categories || "[]"),
      keyFiles: JSON.parse(f.key_files || "[]"),
      limitations: JSON.parse(f.limitations || "[]"),
    });
    await Bun.write(join(featuresDir, `${f.slug}.md`), content);
    result.features++;
  }

  store.close();
  return result;
}

export function formatSyncResult(result: SyncResult): string {
  return [
    `Synced to Obsidian vault at ${result.vaultPath}:`,
    `  Sessions:  ${result.sessions}`,
    `  Decisions: ${result.decisions}`,
    `  Features:  ${result.features}`,
  ].join("\n");
}
