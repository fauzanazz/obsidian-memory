import { ObsidianCLI, type SearchResult } from "./obsidian-cli";

export interface SearchProvider {
  search(query: string, options?: { path?: string; limit?: number }): Promise<SearchResult[]>;
  name: string;
}

export class ObsidianSearchProvider implements SearchProvider {
  readonly name = "obsidian-cli";
  constructor(private cli: ObsidianCLI) {}

  async search(
    query: string,
    options?: { path?: string; limit?: number }
  ): Promise<SearchResult[]> {
    return this.cli.search(query, options);
  }
}

export class HybridSearchProvider implements SearchProvider {
  readonly name = "obsidian-hybrid-search";
  constructor(private vaultPath: string) {}

  async search(
    query: string,
    options?: { path?: string; limit?: number }
  ): Promise<SearchResult[]> {
    const args = [query];
    if (options?.path) args.push("--scope", options.path);

    const proc = Bun.spawn(["obsidian-hybrid-search", ...args], {
      cwd: this.vaultPath,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, OBSIDIAN_VAULT_PATH: this.vaultPath },
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode !== 0) {
      throw new Error("obsidian-hybrid-search failed");
    }

    // Parse the output — hybrid-search returns structured results
    try {
      return JSON.parse(stdout);
    } catch {
      // Fallback: treat each line as a path
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ path: line.trim(), matches: [] }));
    }
  }
}

export async function detectHybridSearch(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "obsidian-hybrid-search"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export async function createSearchProvider(
  cli: ObsidianCLI,
  vaultPath?: string
): Promise<SearchProvider> {
  if (vaultPath && (await detectHybridSearch())) {
    return new HybridSearchProvider(vaultPath);
  }
  return new ObsidianSearchProvider(cli);
}
