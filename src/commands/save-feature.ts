import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";

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

  const notePath = `Memory/Projects/${project}/Docs/Features/${options.slug}`;

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: feature");
  lines.push(`slug: ${options.slug}`);
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

  return { notePath, slug: options.slug };
}
