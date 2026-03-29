import { findConfig, openStore } from "../lib/config";

export interface SaveDecisionOptions {
  title: string;
  context: string;
  decision: string;
  status?: string;
  categories?: string[];
  impacts?: string[];
  supersedes?: number;
  alternatives?: string[];
  consequences?: string;
}

export async function runSaveDecision(
  cwd: string,
  options: SaveDecisionOptions,
): Promise<{ id: string; adrNumber: number }> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);

  // Parse alternatives from "Name: description" strings
  const alternatives = options.alternatives?.map((alt) => {
    const colonIdx = alt.indexOf(":");
    if (colonIdx > 0) {
      return { name: alt.slice(0, colonIdx).trim(), proscons: alt.slice(colonIdx + 1).trim() };
    }
    return { name: alt, proscons: "" };
  });

  if (options.supersedes) {
    const old = store.getDecisionByADRNumber(options.supersedes);
    if (!old) {
      store.close();
      throw new Error(`Cannot supersede ADR-${String(options.supersedes).padStart(3, "0")}: not found.`);
    }
    store.updateDecisionStatus(old.id, "superseded");
  }

  const { id, adrNumber } = store.insertDecision({
    project: found.config.project,
    title: options.title,
    status: options.status ?? (options.supersedes ? "accepted" : undefined),
    context: options.context,
    decision: options.decision,
    alternatives,
    consequences: options.consequences,
    categories: options.categories,
    impacts: options.impacts,
  });

  store.close();
  return { id, adrNumber };
}
