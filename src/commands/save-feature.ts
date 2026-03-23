import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { featureNote } from "../templates/note-templates";

export interface SaveFeatureOptions {
  slug: string;
  title: string;
  summary: string;
  status: "draft" | "in-progress" | "completed";
  categories: string[];
  keyFiles: string[];
  sessions: string[];
}

export interface SaveFeatureResult {
  notePath: string;
  slug: string;
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
): Promise<SaveFeatureResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);

  // Sanitize slug: allowlist only valid kebab-case characters
  const safeSlug = options.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!safeSlug) {
    throw new Error("Invalid feature slug: slug is empty after sanitization.");
  }

  const notePath = `Memory/Projects/${project}/Docs/Features/${safeSlug}`;

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: feature");
  lines.push(`slug: ${safeSlug}`);
  lines.push(`project: ${project}`);
  lines.push(`status: ${options.status}`);
  lines.push(`created: ${new Date().toISOString().split("T")[0]}`);
  lines.push("categories:");
  for (const c of options.categories) lines.push(`  - ${c}`);
  lines.push("tags:");
  lines.push("  - feature");
  lines.push(`  - project/${project}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${options.title}`);
  lines.push("");
  lines.push(options.summary);
  lines.push("");

  if (options.keyFiles.length > 0) {
    lines.push("## Key Files");
    for (const kf of options.keyFiles) lines.push(`- \`${kf}\``);
    lines.push("");
  }

  if (options.sessions.length > 0) {
    lines.push("## Sessions");
    for (const s of options.sessions) lines.push(`- [[${s}]]`);
    lines.push("");
  }

  await cli.create({
    name: notePath,
    content: lines.join("\n"),
    silent: true,
  });

  return { notePath, slug: safeSlug };
  const date = new Date().toISOString().split("T")[0];

  // Sanitize slug to prevent path traversal
  const safeSlug = options.slug
    .replace(/[\/\\]/g, "-")
    .replace(/\.\./g, "")
    .replace(/^-+|-+$/g, "");
  if (!safeSlug) {
    throw new Error("Invalid slug: must contain at least one valid character.");
  }

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
    slug: safeSlug,
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

  const notePath = `Memory/Projects/${project}/Features/${safeSlug}`;

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
  const indexLine = `\n- [[Features/${safeSlug}|${options.title}]] — ${status} — ${summaryLine}\n`;

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
