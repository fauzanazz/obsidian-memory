import { join, dirname } from "path";

export interface LLMConfig {
  provider: "gemini" | "anthropic" | "openai";
  model: string;
  apiKeyEnv: string;
}

export interface MemoryConfig {
  vault: string;
  project: string;
  agents: string[];
  vaultPath?: string;
  llm?: LLMConfig;
}

const CONFIG_FILENAME = ".obsidian-memory.json";

export async function writeConfig(dir: string, config: MemoryConfig): Promise<void> {
  const filePath = join(dir, CONFIG_FILENAME);
  await Bun.write(filePath, JSON.stringify(config, null, 2) + "\n");
}

export async function readConfig(dir: string): Promise<MemoryConfig | null> {
  const filePath = join(dir, CONFIG_FILENAME);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return file.json();
}

export async function findConfig(
  startDir: string
): Promise<{ config: MemoryConfig; dir: string } | null> {
  let current = startDir;

  while (true) {
    const config = await readConfig(current);
    if (config) return { config, dir: current };

    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  return null;
}

/**
 * Resolve the filesystem path to the Obsidian vault.
 * Checks explicit vaultPath first, then common locations.
 */
export function resolveVaultPath(config: MemoryConfig): string | null {
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
    try {
      const file = Bun.file(join(candidate, "Memory", "Index.md"));
      // Synchronous size check — returns 0 for non-existent files
      if (file.size > 0) return candidate;
    } catch {
      // continue
    }
  }
  return null;
}
