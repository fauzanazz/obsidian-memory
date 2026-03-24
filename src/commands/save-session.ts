import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { sessionNote } from "../templates/note-templates";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import {
  extractEvents,
  appendEvents,
  type ExtractionInput,
} from "../lib/event-extractor";
import { addToIndex } from "../lib/embeddings";

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
  options: SaveSessionOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first.",
    );
  }

  const { vault, project, llm } = found.config;
  const cli = new ObsidianCLI(vault);

  const date = new Date().toISOString().split("T")[0];
  const hash = randomBytes(3).toString("hex");
  const noteName = `Memory/Sessions/${project}/${date}-${options.agent}-${hash}`;

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

  // --- Post-save enrichment (best-effort) ---

  const resolvedVaultPath = resolveVaultPath(found.config);
  const apiKey = process.env[llm?.apiKeyEnv ?? "GEMINI_API_KEY"];

  if (apiKey && resolvedVaultPath) {
    // Extract events and append to events.jsonl
    try {
      const input: ExtractionInput = {
        date,
        summary: options.summary,
        files: options.files,
        decisions: options.decisions,
        sessionPath: noteName + ".md",
      };
      const events = await extractEvents(input, llm);
      await appendEvents(resolvedVaultPath, project, events);
    } catch (err) {
      console.error(
        `[save-session] Event extraction failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Add session note to embedding index
    try {
      await addToIndex(
        resolvedVaultPath,
        {
          path: noteName + ".md",
          content,
        },
        apiKey,
      );
    } catch (err) {
      console.error(
        `[save-session] Embedding failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return noteName;
}

/**
 * Resolve the vault filesystem path from config.
 * Tries config.vaultPath first, then standard Obsidian locations.
 */
function resolveVaultPath(config: {
  vault: string;
  vaultPath?: string;
}): string | null {
  if (config.vaultPath) {
    return config.vaultPath.replace(/^~/, process.env.HOME || "~");
  }

  const home = process.env.HOME || "~";
  const candidates = [
    `${home}/Documents/${config.vault}`,
    `${home}/${config.vault}`,
    `${home}/Obsidian/${config.vault}`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate + "/Memory")) return candidate;
  }

  return null;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}
