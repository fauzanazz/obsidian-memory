import { join, dirname } from "path";
import { mkdirSync } from "fs";
import { MemoryStore } from "./store";
import type { MemoryConfig, LLMConfig } from "./types";

export type { MemoryConfig, LLMConfig };

const V1_CONFIG_FILENAME = ".obsidian-memory.json";
const V2_CONFIG_DIR = ".obsidian-memory";
const V2_CONFIG_FILENAME = "config.json";

export async function writeConfig(dir: string, config: MemoryConfig): Promise<void> {
  const configDir = join(dir, V2_CONFIG_DIR);
  mkdirSync(configDir, { recursive: true });
  await Bun.write(join(configDir, V2_CONFIG_FILENAME), JSON.stringify(config, null, 2) + "\n");
}

export async function readConfig(dir: string): Promise<MemoryConfig | null> {
  // v2 location first
  const v2Path = join(dir, V2_CONFIG_DIR, V2_CONFIG_FILENAME);
  const v2File = Bun.file(v2Path);
  if (await v2File.exists()) return v2File.json();

  // v1 fallback
  const v1Path = join(dir, V1_CONFIG_FILENAME);
  const v1File = Bun.file(v1Path);
  if (await v1File.exists()) return v1File.json();

  return null;
}

export async function findConfig(
  startDir: string,
): Promise<{ config: MemoryConfig; dir: string } | null> {
  let current = startDir;

  while (true) {
    const config = await readConfig(current);
    if (config) return { config, dir: current };

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Open a MemoryStore for the given project directory and config.
 * Creates the .obsidian-memory/ directory if it doesn't exist.
 */
export function openStore(configDir: string, config: MemoryConfig): MemoryStore {
  const storeDir = join(configDir, V2_CONFIG_DIR);
  mkdirSync(storeDir, { recursive: true });
  const dbPath = join(storeDir, "memory.db");
  return new MemoryStore(dbPath, config.project);
}

/**
 * Get the path to the embeddings binary file.
 */
export function getEmbeddingsPath(configDir: string): string {
  return join(configDir, V2_CONFIG_DIR, "embeddings.bin");
}

/**
 * Resolve the filesystem path to the Obsidian vault (for sync command).
 */
export function resolveVaultPath(config: MemoryConfig): string | null {
  const home = process.env.HOME;
  if (config.vaultPath) {
    return config.vaultPath.replace(/^~/, home || "~");
  }
  if (!config.vault || !home) return null;
  const candidates = [
    `${home}/Documents/${config.vault}`,
    `${home}/${config.vault}`,
    `${home}/Obsidian/${config.vault}`,
  ];
  for (const candidate of candidates) {
    try {
      const file = Bun.file(join(candidate, "Memory", "Index.md"));
      if (file.size > 0) return candidate;
    } catch {
      // continue
    }
  }
  return null;
}
