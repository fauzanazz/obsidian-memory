import { join } from "path";

export interface OpenCodeConfig {
  instructions?: string[];
  [key: string]: unknown;
}

export async function generateOpenCodeConfig(projectDir: string): Promise<string> {
  const configPath = join(projectDir, "opencode.json");
  const file = Bun.file(configPath);

  let config: OpenCodeConfig = {};
  if (await file.exists()) {
    config = await file.json();
  }

  // Add AGENTS.md to instructions array
  const instructions = config.instructions || [];
  if (!instructions.includes("AGENTS.md")) {
    instructions.push("AGENTS.md");
  }
  config.instructions = instructions;

  return JSON.stringify(config, null, 2) + "\n";
}

export function getOpenCodeConfigPath(): string {
  return "opencode.json";
}
