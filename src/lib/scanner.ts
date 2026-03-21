export interface DirectoryNode {
  name: string;
  children: DirectoryNode[];
  files: string[];
}

export interface ScanResult {
  files: string[];
  tree: DirectoryNode;
  rootDir: string;
}

const DEFAULT_EXCLUSIONS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "__pycache__",
  ".venv",
  "venv",
  ".env",
  "target",
  ".cache",
  "coverage",
  ".turbo",
];

export function buildTree(files: string[]): DirectoryNode {
  const root: DirectoryNode = { name: ".", children: [], files: [] };

  for (const filePath of files) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      let child = current.children.find((c) => c.name === dirName);
      if (!child) {
        child = { name: dirName, children: [], files: [] };
        current.children.push(child);
      }
      current = child;
    }

    const fileName = parts[parts.length - 1];
    current.files.push(fileName);
  }

  sortNode(root);
  return root;
}

function sortNode(node: DirectoryNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.localeCompare(b));
  for (const child of node.children) {
    sortNode(child);
  }
}

export function renderTree(node: DirectoryNode, indent: string = ""): string {
  const lines: string[] = [];

  for (const child of node.children) {
    lines.push(`${indent}${child.name}/`);
    lines.push(renderTree(child, indent + "  "));
  }

  for (const file of node.files) {
    lines.push(`${indent}${file}`);
  }

  return lines.filter(Boolean).join("\n");
}

export async function scanProject(rootDir: string): Promise<ScanResult> {
  let files: string[];

  try {
    files = await scanWithGit(rootDir);
  } catch {
    files = await scanManually(rootDir);
  }

  return {
    files,
    tree: buildTree(files),
    rootDir,
  };
}

async function scanWithGit(rootDir: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files"], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("git ls-files failed");
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean);
}

async function scanManually(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  await walkDir(rootDir, rootDir, files);
  return files.sort();
}

async function walkDir(
  dir: string,
  rootDir: string,
  files: string[]
): Promise<void> {
  const { readdir } = await import("fs/promises");
  const { join, relative } = await import("path");

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (DEFAULT_EXCLUSIONS.includes(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDir(fullPath, rootDir, files);
    } else {
      files.push(relative(rootDir, fullPath));
    }
  }
}
