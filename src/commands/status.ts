import { join } from "path";
import { findConfig } from "../lib/config";

export interface StatusResult {
  configFound: boolean;
  configVersion: "v1" | "v2" | null;
  project?: string;
  dbExists: boolean;
  dbSessions: number;
  dbEvents: number;
  dbDecisions: number;
  dbFeatures: number;
  embeddingsExists: boolean;
  embeddingsEntries: number;
  hybridSearchAvailable: boolean;
}

export async function runStatus(cwd: string): Promise<StatusResult> {
  const result: StatusResult = {
    configFound: false,
    configVersion: null,
    dbExists: false,
    dbSessions: 0,
    dbEvents: 0,
    dbDecisions: 0,
    dbFeatures: 0,
    embeddingsExists: false,
    embeddingsEntries: 0,
    hybridSearchAvailable: false,
  };

  const found = await findConfig(cwd);
  if (!found) return result;

  result.configFound = true;
  result.project = found.config.project;

  // Detect config version
  const v2Config = Bun.file(join(found.dir, ".obsidian-memory", "config.json"));
  result.configVersion = (await v2Config.exists()) ? "v2" : "v1";

  // Check database
  const dbPath = join(found.dir, ".obsidian-memory", "memory.db");
  const dbFile = Bun.file(dbPath);
  result.dbExists = await dbFile.exists();

  if (result.dbExists) {
    try {
      const { MemoryStore } = await import("../lib/store");
      const store = new MemoryStore(dbPath, found.config.project);
      result.dbSessions = store.listSessions({ limit: 10000 }).length;
      result.dbEvents = store.getEventsByDate().length;
      result.dbDecisions = store.listDecisions().length;
      result.dbFeatures = store.listFeatures().length;
      store.close();
    } catch {
      // DB may be corrupt
    }
  }

  // Check embeddings
  const embPath = join(found.dir, ".obsidian-memory", "embeddings.bin");
  const embFile = Bun.file(embPath);
  result.embeddingsExists = await embFile.exists();

  if (result.embeddingsExists) {
    try {
      const { loadEmbeddingsFile } = await import("../lib/embeddings-bin");
      const index = await loadEmbeddingsFile(embPath);
      result.embeddingsEntries = index?.count ?? 0;
    } catch {
      // embeddings may be corrupt
    }
  }

  result.hybridSearchAvailable = !!process.env.GEMINI_API_KEY;

  return result;
}

export function formatStatus(status: StatusResult): string {
  const lines: string[] = [];
  lines.push("# obsidian-memory status\n");

  if (status.configFound) {
    lines.push(`Config:      found (${status.configVersion}, project: ${status.project})`);
  } else {
    lines.push("Config:      not found (run `obsidian-memory init`)");
    return lines.join("\n");
  }

  lines.push(`Database:    ${status.dbExists ? "ok" : "not found"}`);
  if (status.dbExists) {
    lines.push(`  Sessions:  ${status.dbSessions}`);
    lines.push(`  Events:    ${status.dbEvents}`);
    lines.push(`  Decisions: ${status.dbDecisions}`);
    lines.push(`  Features:  ${status.dbFeatures}`);
  }

  lines.push(`Embeddings:  ${status.embeddingsExists ? `${status.embeddingsEntries} entries` : "none"}`);
  lines.push(`Search:      ${status.hybridSearchAvailable ? "hybrid (keyword + vector)" : "keyword only (set GEMINI_API_KEY for hybrid)"}`);

  return lines.join("\n");
}
