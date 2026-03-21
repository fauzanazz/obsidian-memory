import { ObsidianCLI, type SearchResult } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { createSearchProvider } from "../lib/search";

export interface SearchCommandOptions {
  path?: string;
  limit?: number;
}

export async function runSearch(
  cwd: string,
  query: string,
  options?: SearchCommandOptions
): Promise<{ results: SearchResult[]; provider: string }> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, vaultPath } = found.config;
  const cli = new ObsidianCLI(vault);

  const provider = await createSearchProvider(cli, vaultPath);

  const results = await provider.search(query, {
    path: options?.path || "Memory/",
    limit: options?.limit,
  });

  return { results, provider: provider.name };
}

export function formatSearchResults(
  results: SearchResult[],
  provider: string
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s) via ${provider}:\n`);

  for (const result of results) {
    lines.push(`  ${result.path}`);
    if (result.matches?.length) {
      for (const match of result.matches.slice(0, 2)) {
        lines.push(`    > ${match}`);
      }
    }
  }

  return lines.join("\n");
}
