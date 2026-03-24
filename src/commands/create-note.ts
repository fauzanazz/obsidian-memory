import { findConfig } from "../lib/config";
import { ObsidianCLI } from "../lib/obsidian-cli";

export interface CreateNoteOptions {
  path: string;
  content: string;
  vault?: string;
  overwrite?: boolean;
}

export async function runCreateNote(
  cwd: string,
  options: CreateNoteOptions
): Promise<string> {
  // Use provided vault or read from config
  let vaultName = options.vault;
  if (!vaultName) {
    const result = await findConfig(cwd);
    if (!result) {
      throw new Error(
        "No .obsidian-memory.json found and no --vault specified"
      );
    }
    vaultName = result.config.vault;
  }

  const cli = new ObsidianCLI(vaultName);

  // Ensure path ends with .md
  const notePath = options.path.endsWith(".md")
    ? options.path
    : `${options.path}.md`;

  await cli.create({
    name: notePath,
    content: options.content,
    overwrite: options.overwrite,
  });

  return notePath;
}
