import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";

export interface SaveDecisionOptions {
  title: string;
  context: string;
  decision: string;
  categories: string[];
  impacts: string[];
  alternatives: string[];
  consequences: string;
}

export interface SaveDecisionResult {
  notePath: string;
  adrNumber: number;
}

export async function runSaveDecision(
  cwd: string,
  options: SaveDecisionOptions
): Promise<SaveDecisionResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);

  // Determine next ADR number by searching existing decisions
  const adrNumber = await getNextAdrNumber(cli, project);
  const adrId = `ADR-${String(adrNumber).padStart(3, "0")}`;
  const slug = options.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

  const notePath = `Memory/Projects/${project}/Decisions/${adrId}-${slug}`;
  const date = new Date().toISOString().split("T")[0];

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: decision");
  lines.push(`adr: ${adrNumber}`);
  lines.push(`project: ${project}`);
  lines.push(`created: ${date}`);
  lines.push("status: accepted");
  lines.push("categories:");
  for (const c of options.categories) lines.push(`  - ${c}`);
  lines.push("impacts:");
  for (const i of options.impacts) lines.push(`  - ${i}`);
  lines.push("tags:");
  lines.push("  - decision");
  lines.push(`  - project/${project}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${adrId}: ${options.title}`);
  lines.push("");
  lines.push("## Context");
  lines.push(options.context);
  lines.push("");
  lines.push("## Decision");
  lines.push(options.decision);
  lines.push("");

  if (options.alternatives.length > 0) {
    lines.push("## Alternatives Considered");
    for (const a of options.alternatives) lines.push(`- ${a}`);
    lines.push("");
  }

  lines.push("## Consequences");
  lines.push(options.consequences);
  lines.push("");

  await cli.create({
    name: notePath,
    content: lines.join("\n"),
    silent: true,
  });

  return { notePath, adrNumber };
}

async function getNextAdrNumber(
  cli: ObsidianCLI,
  project: string
): Promise<number> {
  try {
    const results = await cli.search("ADR-", {
      path: `Memory/Projects/${project}/Decisions/`,
      limit: 50,
    });

    let maxNumber = 0;
    for (const result of results) {
      const match = result.path.match(/ADR-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }
    return maxNumber + 1;
  } catch {
    return 1;
  }
}
