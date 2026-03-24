import { ObsidianCLI, type SearchResult } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { createSearchProvider, type HybridSearchResult } from "../lib/search";

export interface SearchCommandOptions {
  path?: string;
  limit?: number;
}

export async function runSearch(
  cwd: string,
  query: string,
  options?: SearchCommandOptions,
): Promise<{ results: SearchResult[]; provider: string }> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first.",
    );
  }

  const { vault } = found.config;
  const cli = new ObsidianCLI(vault);

  // Resolve vault filesystem path for hybrid search
  const resolvedPath = resolveVaultPath(found.config);

  const provider = await createSearchProvider(cli, resolvedPath ?? undefined);

  const results = await provider.search(query, {
    path: options?.path || "Memory/",
    limit: options?.limit,
  });

  return { results, provider: provider.name };
}

export function formatSearchResults(
  results: SearchResult[],
  provider: string,
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s) via ${provider}:\n`);

  for (const result of results) {
    const hybrid = result as HybridSearchResult;
    const sourceTag = hybrid.sources
      ? ` [${hybrid.sources.join("+")}]`
      : "";
    lines.push(`  ${result.path}${sourceTag}`);
    if (result.matches?.length) {
      for (const match of result.matches.slice(0, 2)) {
        lines.push(`    > ${match}`);
      }
    }
  }

  return lines.join("\n");
}

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
    try {
      if (Bun.file(candidate + "/Memory/Index.md").size > 0) return candidate;
    } catch {}
  }
  return null;
}
