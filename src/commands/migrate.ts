import { join } from "path";
import { readdir, readFile } from "fs/promises";
import { findConfig, openStore, getEmbeddingsPath } from "../lib/config";
import { emptyIndex, addEntry, contentHash, saveEmbeddingsFile } from "../lib/embeddings-bin";
import type { EventRecord } from "../lib/types";

export interface MigrateOptions {
  fromVault: string;
}

export interface MigrateResult {
  sessions: number;
  events: number;
  decisions: number;
  features: number;
  embeddings: number;
  message: string;
}

export async function runMigrate(
  cwd: string,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const project = found.config.project;
  const vaultPath = options.fromVault.replace(/^~/, process.env.HOME || "~");

  const result: MigrateResult = {
    sessions: 0,
    events: 0,
    decisions: 0,
    features: 0,
    embeddings: 0,
    message: "",
  };

  // 1. Migrate sessions
  const sessionsDir = join(vaultPath, "Memory", "Sessions", project);
  try {
    const files = await readdir(sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await readFile(join(sessionsDir, file), "utf-8");
        const parsed = parseSessionNote(file, content, project);
        if (parsed) {
          store.insertSession(parsed.id, parsed.opts);
          // Create base event for each migrated session
          store.insertBaseEvent(parsed.id, parsed.opts);
          result.sessions++;
        }
      } catch { /* skip unparseable */ }
    }
  } catch { /* sessions dir may not exist */ }

  // 2. Migrate events from events.jsonl
  const eventsPath = join(vaultPath, "Memory", "Projects", project, "events.jsonl");
  try {
    const eventsText = await readFile(eventsPath, "utf-8");
    for (const line of eventsText.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const record: EventRecord = {
          project,
          sessionId: "", // no reliable way to link back
          date: event.date || "",
          subject: event.subject || "",
          action: event.action || "",
          object: event.object || "",
          aliases: Array.isArray(event.aliases) ? event.aliases.join(" ") : "",
          files: Array.isArray(event.files) ? event.files.join(" ") : "",
          isBase: false,
        };
        store.insertEvent(record);
        result.events++;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* events.jsonl may not exist */ }

  // 3. Migrate decisions (ADR notes)
  const adrsDir = join(vaultPath, "Memory", "Projects", project, "ADRs");
  try {
    const files = await readdir(adrsDir);
    for (const file of files) {
      if (!file.endsWith(".md") || !file.startsWith("ADR-")) continue;
      try {
        const content = await readFile(join(adrsDir, file), "utf-8");
        const parsed = parseADRNote(content, project);
        if (parsed) {
          store.insertDecision(parsed);
          result.decisions++;
        }
      } catch { /* skip unparseable */ }
    }
  } catch { /* ADRs dir may not exist */ }

  // 4. Migrate features
  const featuresDir = join(vaultPath, "Memory", "Projects", project, "Features");
  try {
    const files = await readdir(featuresDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await readFile(join(featuresDir, file), "utf-8");
        const slug = file.replace(/\.md$/, "");
        const parsed = parseFeatureNote(content, project, slug);
        if (parsed) {
          store.insertFeature(parsed);
          result.features++;
        }
      } catch { /* skip unparseable */ }
    }
  } catch { /* features dir may not exist */ }

  // 5. Migrate embeddings from index.json → embeddings.bin
  const indexJsonPath = join(vaultPath, "Memory", ".embeddings", "index.json");
  try {
    const indexText = await readFile(indexJsonPath, "utf-8");
    const indexData = JSON.parse(indexText);
    if (indexData.entries && Array.isArray(indexData.entries)) {
      const dimension = indexData.dimension || 768;
      let binIndex = emptyIndex(dimension);
      for (const entry of indexData.entries) {
        if (entry.path && entry.embedding && Array.isArray(entry.embedding)) {
          const hash = contentHash(entry.content_hash || entry.path);
          binIndex = addEntry(binIndex, entry.path, hash, new Float32Array(entry.embedding));
          result.embeddings++;
        }
      }
      if (result.embeddings > 0) {
        const embPath = getEmbeddingsPath(found.dir);
        await saveEmbeddingsFile(embPath, binIndex);
      }
    }
  } catch { /* index.json may not exist */ }

  store.close();

  result.message = [
    `Migration from ${vaultPath} complete:`,
    `  Sessions:   ${result.sessions}`,
    `  Events:     ${result.events}`,
    `  Decisions:  ${result.decisions}`,
    `  Features:   ${result.features}`,
    `  Embeddings: ${result.embeddings}`,
  ].join("\n");

  return result;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const props: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      props[key] = value;
    }
  }
  return props;
}

function extractSection(content: string, heading: string): string {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`);
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

function parseSessionNote(
  filename: string,
  content: string,
  project: string,
): { id: string; opts: import("../lib/types").SaveSessionOptions } | null {
  const fm = parseFrontmatter(content);
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch?.[1] || fm.created || new Date().toISOString().slice(0, 10);
  const agent = fm.agent || "unknown";
  const id = filename.replace(/\.md$/, "");

  const summary = extractSection(content, "Summary");
  if (!summary) return null;

  const files = extractListItems(content, "Files Modified");
  const decisions = extractListItems(content, "Decisions Made");
  const blockers = extractListItems(content, "Blockers");
  const nextSteps = extractListItems(content, "Next Steps");

  return {
    id,
    opts: {
      project,
      agent,
      date,
      summary,
      content,
      files,
      decisions,
      blockers,
      nextSteps,
    },
  };
}

function parseADRNote(
  content: string,
  project: string,
): import("../lib/types").DecisionRecord | null {
  const fm = parseFrontmatter(content);
  const titleMatch = content.match(/^# (.+)/m);
  const title = titleMatch?.[1] || fm.title || "";
  if (!title) return null;

  return {
    project,
    title,
    status: fm.status || "accepted",
    context: extractSection(content, "Context"),
    decision: extractSection(content, "Decision"),
    consequences: extractSection(content, "Consequences") || undefined,
    categories: fm.categories?.split(",").map((s) => s.trim()) || [],
  };
}

function parseFeatureNote(
  content: string,
  project: string,
  slug: string,
): import("../lib/types").FeatureRecord | null {
  const fm = parseFrontmatter(content);
  const titleMatch = content.match(/^# (.+)/m);
  const title = titleMatch?.[1] || fm.title || slug;

  return {
    project,
    slug,
    title,
    status: fm.status || "in-progress",
    summary: extractSection(content, "Summary") || undefined,
    categories: fm.categories?.split(",").map((s) => s.trim()) || [],
  };
}

function extractListItems(content: string, heading: string): string[] {
  const section = extractSection(content, heading);
  if (!section) return [];
  return section
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.trim().replace(/^- /, "").replace(/`/g, ""));
}
