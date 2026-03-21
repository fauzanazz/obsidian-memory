import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { randomBytes } from "crypto";

export interface SaveSessionOptions {
  agent: string;
  summary: string;
  decisions?: string[];
  files?: string[];
  blockers?: string[];
  nextSteps?: string[];
}

export async function runSaveSession(
  cwd: string,
  options: SaveSessionOptions
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
  const hash = randomBytes(3).toString("hex");
  const noteName = `Memory/Sessions/${date}-${options.agent}-${hash}`;

  const content = buildSessionContent(project, options);

  await cli.create({
    name: noteName,
    content,
    silent: true,
  });

  // Update progress file with latest session reference
  try {
    await cli.prepend({
      path: `Memory/Projects/${project}/progress.md`,
      content: `\n- ${date}: [[${date}-${options.agent}-${hash}|${options.agent} session]] — ${truncate(options.summary, 80)}\n`,
    });
  } catch {
    // Progress file may not exist yet — not critical
  }

  return noteName;
}

function buildSessionContent(project: string, options: SaveSessionOptions): string {
  const date = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  lines.push("---");
  lines.push("type: session");
  lines.push(`agent: ${options.agent}`);
  lines.push(`project: ${project}`);
  lines.push(`created: ${date}`);
  lines.push(`updated: ${date}`);
  lines.push("tags:");
  lines.push("  - session");
  lines.push(`  - agent/${options.agent}`);
  lines.push(`  - project/${project}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Session — ${date} — ${options.agent}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(options.summary);
  lines.push("");

  if (options.decisions?.length) {
    lines.push("## Decisions Made");
    for (const d of options.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push("");
  }

  if (options.files?.length) {
    lines.push("## Files Modified");
    for (const f of options.files) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  if (options.blockers?.length) {
    lines.push("## Blockers");
    for (const b of options.blockers) {
      lines.push(`- ${b}`);
    }
    lines.push("");
  }

  if (options.nextSteps?.length) {
    lines.push("## Next Steps");
    for (const n of options.nextSteps) {
      lines.push(`- ${n}`);
    }
    lines.push("");
  }

  lines.push(`## Links`);
  lines.push(`- Project: [[${project}/context|${project}]]`);
  lines.push(`- Decisions: [[${project}/decisions|${project} decisions]]`);
  lines.push("");

  return lines.join("\\n");
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
