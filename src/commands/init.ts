import { join } from "path";
import { access, mkdir } from "fs/promises";
import { writeConfig } from "../lib/config";
import { getVaultStructure } from "../lib/vault";
import { generateAgentsMd } from "../templates/agents-md";
import { generateClaudeCodeConfig, getClaudeCodeConfigPath } from "../lib/agents/claude-code";
import { generateCursorConfig, getCursorConfigPath } from "../lib/agents/cursor";
import { generateAntigravityConfig, getAntigravityConfigPath } from "../lib/agents/antigravity";
import { generateOpenCodeConfig, getOpenCodeConfigPath } from "../lib/agents/opencode";
import { generateForgeCodeConfig, getForgeCodeConfigPath } from "../lib/agents/forgecode";

export type AgentId = "claude-code" | "cursor" | "antigravity" | "opencode" | "forgecode";

interface AgentDetection {
  id: AgentId;
  label: string;
  detected: boolean;
  indicator: string;
}

export async function detectAgents(projectDir: string): Promise<AgentDetection[]> {
  const agents: AgentDetection[] = [
    { id: "claude-code", label: "Claude Code", detected: false, indicator: ".claude/" },
    { id: "cursor", label: "Cursor", detected: false, indicator: ".cursor/" },
    { id: "antigravity", label: "Antigravity (Gemini)", detected: false, indicator: "GEMINI.md" },
    { id: "opencode", label: "OpenCode", detected: false, indicator: ".opencode/" },
    { id: "forgecode", label: "ForgeCode", detected: false, indicator: "forge.yaml" },
  ];

  for (const agent of agents) {
    try {
      await access(join(projectDir, agent.indicator));
      agent.detected = true;
    } catch {
      agent.detected = false;
    }
  }

  return agents;
}

export interface InitOptions {
  vault: string;
  project: string;
  agents: AgentId[];
  vaultPath?: string; // filesystem path to create vault structure
}

export interface InitResult {
  configWritten: boolean;
  agentsMdWritten: boolean;
  agentConfigs: { agent: AgentId; path: string }[];
  vaultStructureCreated: boolean;
  vaultFolders: number;
  vaultFiles: number;
}

export async function runInit(
  projectDir: string,
  options: InitOptions
): Promise<InitResult> {
  const result: InitResult = {
    configWritten: false,
    agentsMdWritten: false,
    agentConfigs: [],
    vaultStructureCreated: false,
    vaultFolders: 0,
    vaultFiles: 0,
  };

  // Write .obsidian-memory.json
  await writeConfig(projectDir, {
    vault: options.vault,
    project: options.project,
    agents: options.agents,
  });
  result.configWritten = true;

  // Generate and write AGENTS.md
  const agentsMd = generateAgentsMd(options.project, options.vault);
  await Bun.write(join(projectDir, "AGENTS.md"), agentsMd);
  result.agentsMdWritten = true;

  // Generate agent-specific configs
  for (const agentId of options.agents) {
    const configResult = await writeAgentConfig(projectDir, agentId);
    if (configResult) {
      result.agentConfigs.push(configResult);
    }
  }

  // Create vault structure if path provided
  if (options.vaultPath) {
    const structure = getVaultStructure(options.project);

    for (const folder of structure.folders) {
      await mkdir(join(options.vaultPath, folder), { recursive: true });
    }
    result.vaultFolders = structure.folders.length;

    for (const file of structure.files) {
      const filePath = join(options.vaultPath, file.path);
      const dir = join(filePath, "..");
      await mkdir(dir, { recursive: true });
      await Bun.write(filePath, file.content);
    }
    result.vaultFiles = structure.files.length;
    result.vaultStructureCreated = true;
  }

  return result;
}

async function writeAgentConfig(
  projectDir: string,
  agentId: AgentId
): Promise<{ agent: AgentId; path: string } | null> {
  let content: string;
  let configPath: string;

  switch (agentId) {
    case "claude-code": {
      content = generateClaudeCodeConfig();
      configPath = getClaudeCodeConfigPath();
      // Append to existing CLAUDE.md if it exists
      const existing = Bun.file(join(projectDir, configPath));
      if (await existing.exists()) {
        const existingContent = await existing.text();
        if (existingContent.includes("AGENTS.md")) return { agent: agentId, path: configPath };
        content = existingContent.trimEnd() + "\n\n" + content;
      }
      break;
    }
    case "cursor": {
      content = generateCursorConfig();
      configPath = getCursorConfigPath();
      await mkdir(join(projectDir, ".cursor", "rules"), { recursive: true });
      break;
    }
    case "antigravity": {
      content = generateAntigravityConfig();
      configPath = getAntigravityConfigPath();
      const existing = Bun.file(join(projectDir, configPath));
      if (await existing.exists()) {
        const existingContent = await existing.text();
        if (existingContent.includes("AGENTS.md")) return { agent: agentId, path: configPath };
        content = existingContent.trimEnd() + "\n\n" + content;
      }
      break;
    }
    case "opencode": {
      content = await generateOpenCodeConfig(projectDir);
      configPath = getOpenCodeConfigPath();
      break;
    }
    case "forgecode": {
      content = await generateForgeCodeConfig(projectDir);
      configPath = getForgeCodeConfigPath();
      break;
    }
    default:
      return null;
  }

  await Bun.write(join(projectDir, configPath), content);
  return { agent: agentId, path: configPath };
}

export function formatInitResult(result: InitResult): string {
  const lines: string[] = [];
  lines.push("obsidian-memory initialized successfully!\n");

  if (result.configWritten) lines.push("  .obsidian-memory.json written");
  if (result.agentsMdWritten) lines.push("  AGENTS.md generated");

  for (const ac of result.agentConfigs) {
    lines.push(`  ${ac.path} configured for ${ac.agent}`);
  }

  if (result.vaultStructureCreated) {
    lines.push(
      `\n  Vault structure created: ${result.vaultFolders} folders, ${result.vaultFiles} files`
    );
  }

  lines.push("\nNext steps:");
  lines.push("  1. Open the vault in Obsidian");
  lines.push("  2. Start an AI agent session — it will read AGENTS.md and use memory automatically");

  return lines.join("\n");
}
