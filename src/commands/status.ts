import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { detectHybridSearch } from "../lib/search";

export interface StatusResult {
  configFound: boolean;
  vault?: string;
  project?: string;
  obsidianRunning: boolean;
  cliAvailable: boolean;
  obsidianVersion?: string;
  vaultHealthy?: boolean;
  missingFolders?: string[];
  hybridSearchAvailable: boolean;
}

export async function runStatus(cwd: string): Promise<StatusResult> {
  const result: StatusResult = {
    configFound: false,
    obsidianRunning: false,
    cliAvailable: false,
    hybridSearchAvailable: false,
  };

  // Find config
  const found = await findConfig(cwd);
  if (found) {
    result.configFound = true;
    result.vault = found.config.vault;
    result.project = found.config.project;
  }

  // Check Obsidian availability
  const cli = new ObsidianCLI(result.vault || "");
  const availability = await cli.checkAvailability();
  result.obsidianRunning = availability.obsidianRunning;
  result.cliAvailable = availability.cliAvailable;
  result.obsidianVersion = availability.version;

  // Check vault health (only if we know the vault path)
  // Note: vault health check requires knowing the filesystem path to the vault
  // For now, we skip this unless we can resolve it

  // Check hybrid search
  result.hybridSearchAvailable = await detectHybridSearch();

  return result;
}

export function formatStatus(status: StatusResult): string {
  const lines: string[] = [];

  lines.push("# obsidian-memory status\n");

  if (status.configFound) {
    lines.push(`Config:    found (vault: ${status.vault}, project: ${status.project})`);
  } else {
    lines.push("Config:    not found (run `obsidian-memory init`)");
  }

  lines.push(
    `Obsidian:  ${status.obsidianRunning ? "running" : "not running"}${
      status.obsidianVersion ? ` (v${status.obsidianVersion})` : ""
    }`
  );
  lines.push(`CLI:       ${status.cliAvailable ? "available" : "not available"}`);
  lines.push(
    `Search:    ${status.hybridSearchAvailable ? "hybrid (semantic + keyword)" : "keyword only"}`
  );

  if (status.vaultHealthy !== undefined) {
    lines.push(
      `Vault:     ${status.vaultHealthy ? "healthy" : `issues (missing: ${status.missingFolders?.join(", ")})`}`
    );
  }

  return lines.join("\n");
}
