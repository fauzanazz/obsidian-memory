import { join } from "path";

export type ProjectType = "node" | "python" | "rust" | "unknown";

export interface EntryPoint {
  path: string;
  source: string;
}

export interface ModuleInfo {
  directory: string;
  entryFile: string;
  fileCount: number;
}

export interface ProjectInfo {
  type: ProjectType;
  entryPoints: EntryPoint[];
  modules: ModuleInfo[];
}

const MODULE_ENTRY_FILES = [
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "index.mts",
  "index.mjs",
  "__init__.py",
  "mod.rs",
];

export function detectProjectType(files: string[]): ProjectType {
  const fileNames = new Set(files.map((f) => f.split("/").pop()!));
  const topLevelFiles = new Set(files.filter((f) => !f.includes("/")));

  if (topLevelFiles.has("package.json")) return "node";
  if (topLevelFiles.has("Cargo.toml")) return "rust";
  if (topLevelFiles.has("pyproject.toml") || topLevelFiles.has("setup.py"))
    return "python";

  // Check for language markers anywhere
  if (fileNames.has("package.json")) return "node";
  if (fileNames.has("Cargo.toml")) return "rust";
  if (fileNames.has("pyproject.toml")) return "python";

  return "unknown";
}

export async function detectEntryPoints(
  rootDir: string,
  files: string[],
  projectType: ProjectType
): Promise<EntryPoint[]> {
  const entries: EntryPoint[] = [];

  if (projectType === "node") {
    const pkgJsonPath = files.find(
      (f) => f === "package.json" || f.endsWith("/package.json")
    );
    if (pkgJsonPath) {
      try {
        const pkg = await Bun.file(join(rootDir, pkgJsonPath)).json();

        if (pkg.main) {
          entries.push({ path: pkg.main, source: "package.json:main" });
        }
        if (pkg.bin) {
          if (typeof pkg.bin === "string") {
            entries.push({ path: pkg.bin, source: "package.json:bin" });
          } else {
            for (const [name, path] of Object.entries(pkg.bin)) {
              entries.push({
                path: path as string,
                source: `package.json:bin.${name}`,
              });
            }
          }
        }
        if (pkg.exports) {
          if (typeof pkg.exports === "string") {
            entries.push({ path: pkg.exports, source: "package.json:exports" });
          } else if (typeof pkg.exports === "object") {
            for (const [key, val] of Object.entries(pkg.exports)) {
              const resolved =
                typeof val === "string"
                  ? val
                  : typeof val === "object" && val !== null
                    ? (val as Record<string, string>).import ||
                      (val as Record<string, string>).default
                    : undefined;
              if (resolved) {
                entries.push({
                  path: resolved,
                  source: `package.json:exports[${key}]`,
                });
              }
            }
          }
        }
      } catch {
        // package.json parse failed, skip
      }
    }
  }

  if (projectType === "python") {
    // Common Python entry points
    for (const f of files) {
      if (f === "main.py" || f.endsWith("/main.py")) {
        entries.push({ path: f, source: "main.py" });
      }
      if (f === "app.py" || f.endsWith("/app.py")) {
        entries.push({ path: f, source: "app.py" });
      }
    }
  }

  if (projectType === "rust") {
    for (const f of files) {
      if (f === "src/main.rs") {
        entries.push({ path: f, source: "src/main.rs" });
      }
      if (f === "src/lib.rs") {
        entries.push({ path: f, source: "src/lib.rs" });
      }
    }
  }

  return entries;
}

export function detectModules(files: string[]): ModuleInfo[] {
  // Group files by directory
  const dirFiles = new Map<string, string[]>();

  for (const file of files) {
    const lastSlash = file.lastIndexOf("/");
    if (lastSlash === -1) continue; // skip root-level files

    const dir = file.substring(0, lastSlash);
    const fileName = file.substring(lastSlash + 1);

    if (!dirFiles.has(dir)) {
      dirFiles.set(dir, []);
    }
    dirFiles.get(dir)!.push(fileName);
  }

  const modules: ModuleInfo[] = [];

  for (const [dir, fileNames] of dirFiles) {
    const entryFile = fileNames.find((f) => MODULE_ENTRY_FILES.includes(f));

    // Include if has entry file OR has 2+ files (meaningful directory)
    if (entryFile || fileNames.length >= 2) {
      modules.push({
        directory: dir,
        entryFile: entryFile || "",
        fileCount: fileNames.length,
      });
    }
  }

  return modules.sort((a, b) => a.directory.localeCompare(b.directory));
}

export async function detectProject(
  rootDir: string,
  files: string[]
): Promise<ProjectInfo> {
  const type = detectProjectType(files);
  const entryPoints = await detectEntryPoints(rootDir, files, type);
  const modules = detectModules(files);

  return { type, entryPoints, modules };
}
