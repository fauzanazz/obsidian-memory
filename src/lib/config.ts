import { join, dirname } from "path";

export interface MemoryConfig {
  vault: string;
  project: string;
  agents: string[];
  vaultPath?: string;
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
