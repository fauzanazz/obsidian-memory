import { ObsidianCLI } from "../lib/obsidian-cli";
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
}

const DOC_NOTES = [
  { name: "Architecture", generate: "architecture" },
  { name: "Features", generate: "features" },
  { name: "Modules", generate: "modules" },
  { name: "Conventions", generate: "conventions" },
] as const;

export async function runDocument(
  cwd: string,
  options?: DocumentOptions
): Promise<DocumentResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);
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

  const result: DocumentResult = {
    created: [],
    updated: [],
    project,
  };

  const docsPath = `Memory/Projects/${project}/Docs`;

  for (const { name } of DOC_NOTES) {
    const notePath = `${docsPath}/${name}.md`;
    const newContent = docs[name];

    if (options?.force) {
      // Force: always overwrite
      try {
        await cli.create({
          name: notePath,
          content: newContent,
          overwrite: true,
        });
      } catch {
        // Try creating if overwrite fails (note might not exist)
        await cli.create({ name: notePath, content: newContent });
      }
      result.created.push(name);
      continue;
    }

    // Try to read existing content for merge
    let existingContent = "";
    try {
      existingContent = await cli.read({ path: notePath });
    } catch {
      // Note doesn't exist yet
    }

    if (existingContent) {
      // Merge: update auto sections, preserve agent content
      const merged = mergeWithExisting(newContent, existingContent);
      await cli.create({
        name: notePath,
        content: merged,
        overwrite: true,
      });
      result.updated.push(name);
    } else {
      // Create new
      await cli.create({ name: notePath, content: newContent });
      result.created.push(name);
    }
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

  lines.push(
    `\nDocs are in Memory/Projects/${result.project}/Docs/`
  );
  lines.push(
    "Agents will consult these docs before creating or debugging."
  );

  return lines.join("\n");
}
