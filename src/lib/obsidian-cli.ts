function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

/** Escape content for Obsidian CLI: real newlines → \n, tabs → \t, backslashes → \\\\ */
export function escapeContent(content: string): string {
  return content
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

export interface FileTarget {
  file?: string;
  path?: string;
}

export interface CreateOptions {
  name: string;
  content: string;
  template?: string;
  silent?: boolean;
  overwrite?: boolean;
}

export interface SearchOptions {
  path?: string;
  limit?: number;
}

export interface SearchResult {
  path: string;
  matches: string[];
}

export interface SetPropertyOptions extends FileTarget {
  name: string;
  value: string;
  type?: string;
}

export interface AvailabilityResult {
  obsidianRunning: boolean;
  cliAvailable: boolean;
  version?: string;
}

export class ObsidianCLI {
  readonly vault: string;

  constructor(vault: string) {
    this.vault = vault;
  }

  async exec(args: string[]): Promise<string> {
    const cmd = ["obsidian", `vault=${this.vault}`, ...args];
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `obsidian CLI exited with code ${exitCode}`);
    }

    const output = stdout.trim();

    // Obsidian CLI returns exit 0 with "Error:" prefix for some errors
    if (output.startsWith("Error:")) {
      throw new Error(output);
    }

    return output;
  }

  async read(target: FileTarget): Promise<string> {
    const args = ["read", ...this.buildTargetArgs(target)];
    return this.exec(args);
  }

  async create(options: CreateOptions): Promise<string> {
    const args = ["create"];
    // Obsidian CLI rejects "/" in name — use path for nested paths
    if (options.name.includes("/")) {
      const path = options.name.endsWith(".md") ? options.name : `${options.name}.md`;
      args.push(`path=${path}`);
    } else {
      args.push(`name=${options.name}`);
    }
    args.push(`content=${escapeContent(options.content)}`);
    if (options.template) args.push(`template=${options.template}`);
    if (options.silent) args.push("silent");
    if (options.overwrite) args.push("overwrite");
    return this.exec(args);
  }

  async append(options: FileTarget & { content: string }): Promise<string> {
    const args = ["append", ...this.buildTargetArgs(options), `content=${escapeContent(options.content)}`];
    return this.exec(args);
  }

  async prepend(options: FileTarget & { content: string }): Promise<string> {
    const args = ["prepend", ...this.buildTargetArgs(options), `content=${escapeContent(options.content)}`];
    return this.exec(args);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const args = ["search", `query=${query}`, "format=json"];
    if (options?.path) args.push(`path=${options.path}`);
    if (options?.limit) args.push(`limit=${options.limit}`);
    const output = await this.exec(args);
    if (!output || !output.startsWith("[")) return [];
    const raw: string[] = JSON.parse(output);
    // CLI returns a flat string array of paths — map to SearchResult
    return raw.map((path) => ({ path, matches: [] }));
  }

  async getProperties(target: FileTarget): Promise<Record<string, string>> {
    const args = ["properties", ...this.buildTargetArgs(target)];
    const output = await this.exec(args);
    return this.parseYamlProperties(output);
  }

  async setProperty(options: SetPropertyOptions): Promise<void> {
    const args = [
      "property:set",
      ...this.buildTargetArgs(options),
      `name=${options.name}`,
      `value=${options.value}`,
    ];
    if (options.type) args.push(`type=${options.type}`);
    await this.exec(args);
  }

  async getFilesWithTag(tag: string): Promise<string[]> {
    const args = ["tag", `name=${tag}`];
    const output = await this.exec(args);
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  }

  async getBacklinks(target: FileTarget): Promise<string[]> {
    const args = ["backlinks", ...this.buildTargetArgs(target), "format=json"];
    const output = await this.exec(args);
    if (!output || output.startsWith("No ")) return [];
    return JSON.parse(output);
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    const result: AvailabilityResult = {
      obsidianRunning: false,
      cliAvailable: false,
    };

    // Check if Obsidian process is running
    try {
      const pgrep = Bun.spawn(["pgrep", "-x", "Obsidian"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await withTimeout(pgrep.exited, 5000);
      result.obsidianRunning = exitCode === 0;
    } catch {
      result.obsidianRunning = false;
    }

    // Check if CLI is available and get version
    try {
      // First check if the obsidian binary exists
      const which = Bun.spawn(["which", "obsidian"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const whichExit = await withTimeout(which.exited, 3000);
      if (whichExit !== 0) throw new Error("not found");

      const proc = Bun.spawn(["obsidian", "version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await withTimeout(proc.exited, 5000).catch(() => {
        proc.kill();
        return null;
      });
      if (exitCode === 0) {
        result.cliAvailable = true;
        result.version = (await new Response(proc.stdout).text()).trim();
      }
    } catch {
      result.cliAvailable = false;
    }

    return result;
  }

  private buildTargetArgs(target: FileTarget): string[] {
    const args: string[] = [];
    if (target.file) args.push(`file=${target.file}`);
    if (target.path) args.push(`path=${target.path}`);
    return args;
  }

  private parseYamlProperties(output: string): Record<string, string> {
    const props: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
      if (match) {
        props[match[1]] = match[2].trim();
      }
    }
    return props;
  }
}
