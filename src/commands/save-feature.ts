import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { featureNote } from "../templates/note-templates";

export interface SaveFeatureOptions {
  slug: string;
  title: string;
  status?: "draft" | "in-progress" | "completed" | "deprecated";
  categories?: string[];
  decidedBy?: string[];
  sessions?: string[];
  summary?: string;
  keyFiles?: string[]; // "path:role" format from CLI
  limitations?: string[];
  overwrite?: boolean;
}

export async function runSaveFeature(
  cwd: string,
  options: SaveFeatureOptions
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);

  const date = new Date().toISOString().split("T")[0];

  // Parse keyFiles from "path:role" strings
  const keyFiles = options.keyFiles?.map((entry) => {
    const colonIdx = entry.indexOf(":");
    if (colonIdx === -1) {
      return { path: entry, role: "" };
    }
    return {
      path: entry.slice(0, colonIdx),
      role: entry.slice(colonIdx + 1),
    };
  });

  const status = validStatus(options.status) || "in-progress";

  const content = featureNote({
    project,
    slug: options.slug,
    title: options.title,
    date,
    status,
    categories: options.categories,
    decidedBy: options.decidedBy,
    sessions: options.sessions,
    summary: options.summary,
    keyFiles,
    limitations: options.limitations,
  });

  const notePath = `Memory/Projects/${project}/Features/${options.slug}`;

  await cli.create({
    name: notePath,
    content,
    silent: true,
    overwrite: options.overwrite,
  });

  // Update Features.md index with a wikilink to the new feature note
  const summaryLine = options.summary
    ? truncate(options.summary, 80)
    : "No summary";
  const indexLine = `\n- [[Features/${options.slug}|${options.title}]] — ${status} — ${summaryLine}\n`;

  try {
    await cli.prepend({
      path: `Memory/Projects/${project}/Docs/Features.md`,
      content: indexLine,
    });
  } catch {
    // Features.md index may not exist yet — not critical
  }

  return notePath;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}

const VALID_STATUSES = new Set(["draft", "in-progress", "completed", "deprecated"]);

function validStatus(
  s?: string
): "draft" | "in-progress" | "completed" | "deprecated" | undefined {
  if (s && VALID_STATUSES.has(s)) {
    return s as "draft" | "in-progress" | "completed" | "deprecated";
  }
  return undefined;
}
