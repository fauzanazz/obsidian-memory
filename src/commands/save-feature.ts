import { findConfig, openStore } from "../lib/config";

export interface SaveFeatureOptions {
  slug: string;
  title: string;
  status?: "draft" | "in-progress" | "completed" | "deprecated";
  categories?: string[];
  summary?: string;
  keyFiles?: string[];
  limitations?: string[];
}

export async function runSaveFeature(
  cwd: string,
  options: SaveFeatureOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);

  // Parse keyFiles from "path:role" strings
  const keyFiles = options.keyFiles?.map((entry) => {
    const colonIdx = entry.indexOf(":");
    if (colonIdx === -1) return { path: entry, role: "" };
    return { path: entry.slice(0, colonIdx), role: entry.slice(colonIdx + 1) };
  });

  store.insertFeature({
    project: found.config.project,
    slug: options.slug,
    title: options.title,
    status: options.status,
    summary: options.summary,
    categories: options.categories,
    keyFiles,
    limitations: options.limitations,
  });

  store.close();
  return options.slug;
}
