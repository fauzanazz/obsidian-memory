import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { sessionNote } from "../templates/note-templates";
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

  const content = sessionNote({
    agent: options.agent,
    project,
    date,
    summary: options.summary,
    decisions: options.decisions,
    files: options.files,
    blockers: options.blockers,
    nextSteps: options.nextSteps,
  });

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

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
