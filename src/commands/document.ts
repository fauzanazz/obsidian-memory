import { join } from "path";
import { mkdir } from "fs/promises";
import { findConfig } from "../lib/config";
import { scanProject } from "../lib/scanner";
import { detectProject } from "../lib/project-detector";
import {
  generateArchitecture,
  generateFeatures,
  generateModules,
  generateConventions,
  mergeWithExisting,
} from "../lib/doc-generator";

export interface DocumentOptions {
  force?: boolean;
}

export interface DocumentResult {
  created: string[];
  updated: string[];
  project: string;
  docsDir: string;
}

const DOC_NOTES = [
  { name: "Architecture", generate: "architecture" },
  { name: "Features", generate: "features" },
  { name: "Modules", generate: "modules" },
  { name: "Conventions", generate: "conventions" },
] as const;

export async function runDocument(
  cwd: string,
  options?: DocumentOptions,
): Promise<DocumentResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const { project } = found.config;
  const projectDir = found.dir;

  // Scan project
  const scan = await scanProject(projectDir);
  const info = await detectProject(projectDir, scan.files);

  // Generate doc contents
  const docs: Record<string, string> = {
    Architecture: generateArchitecture(project, scan, info),
    Features: generateFeatures(project),
    Modules: generateModules(project, info),
    Conventions: generateConventions(project),
  };

  // Write to .obsidian-memory/docs/
  const docsDir = join(projectDir, ".obsidian-memory", "docs");
  await mkdir(docsDir, { recursive: true });

  const result: DocumentResult = {
    created: [],
    updated: [],
    project,
    docsDir,
  };

  for (const { name } of DOC_NOTES) {
    const filePath = join(docsDir, `${name}.md`);
    const newContent = docs[name];
    const file = Bun.file(filePath);

    if (options?.force || !(await file.exists())) {
      await Bun.write(filePath, newContent);
      result.created.push(name);
      continue;
    }

    // Merge with existing content
    const existingContent = await file.text();
    const merged = mergeWithExisting(newContent, existingContent);
    await Bun.write(filePath, merged);
    result.updated.push(name);
  }

  return result;
}

export function formatDocumentResult(result: DocumentResult): string {
  const lines: string[] = [];
  lines.push(`Documentation generated for ${result.project}:\n`);

  if (result.created.length > 0) {
    lines.push(`  Created: ${result.created.join(", ")}`);
  }
  if (result.updated.length > 0) {
    lines.push(`  Updated: ${result.updated.join(", ")}`);
  }

  lines.push(`\nDocs written to ${result.docsDir}/`);

  return lines.join("\n");
}
