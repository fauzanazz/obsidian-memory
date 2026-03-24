import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { enrichSession, type EnrichmentResult } from "../lib/enricher";
import { runSaveFeature } from "./save-feature";
import { runSaveDecision } from "./save-decision";

export interface MaintainOptions {
  enrich?: boolean;
  session?: string;
}

export interface MaintainResult {
  sessionsEnriched: number;
  featuresCreated: string[];
  decisionsCreated: string[];
  crossLinksAdded: number;
  contextDriftWarnings: string[];
  message: string;
}

export async function runMaintain(
  cwd: string,
  options: MaintainOptions
): Promise<MaintainResult> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project, llm } = found.config;
  const cli = new ObsidianCLI(vault);

  const result: MaintainResult = {
    sessionsEnriched: 0,
    featuresCreated: [],
    decisionsCreated: [],
    crossLinksAdded: 0,
    contextDriftWarnings: [],
    message: "",
  };

  if (options.enrich) {
    const sessionPaths = await findSessionsToEnrich(
      cli,
      project,
      options.session
    );

    if (sessionPaths.length === 0) {
      result.message = "No unenriched sessions found.";
      return result;
    }

    const featureIndex = await safeRead(
      cli,
      `Memory/Projects/${project}/Docs/Features.md`
    );
    const decisionIndex = await safeRead(
      cli,
      `Memory/Projects/${project}/decisions.md`
    );

    for (const sessionPath of sessionPaths) {
      try {
        const sessionContent = await cli.read({ path: sessionPath });

        const enrichment = await enrichSession(
          sessionContent,
          featureIndex,
          decisionIndex,
          llm
        );

        for (const feature of enrichment.features) {
          try {
            await runSaveFeature(cwd, {
              slug: feature.slug,
              title: feature.title,
              summary: feature.summary,
              status: feature.status,
              categories: feature.categories,
              keyFiles: feature.keyFiles.map((kf) => `${kf.path}:${kf.role}`),
              sessions: [
                sessionPath.split("/").pop()?.replace(".md", "") || "",
              ],
            });
            result.featuresCreated.push(feature.slug);
          } catch {
            // Feature may already exist — skip
          }
        }

        for (const decision of enrichment.decisions) {
          try {
            const { adrNumber } = await runSaveDecision(cwd, {
              title: decision.title,
              context: decision.context,
              decision: decision.decision,
              categories: decision.categories,
              impacts: decision.impacts,
              alternatives: decision.alternatives.map(
                (a) => `${a.name}: ${a.proscons}`
              ),
              consequences: decision.consequences,
            });
            result.decisionsCreated.push(
              `ADR-${String(adrNumber).padStart(3, "0")}`
            );
          } catch {
            // Decision creation failed — skip
          }
        }

        await updateSessionFrontmatter(cli, sessionPath, enrichment);
        result.crossLinksAdded++;

        if (enrichment.contextDrift) {
          result.contextDriftWarnings.push(enrichment.contextDrift);
        }

        result.sessionsEnriched++;
      } catch (err) {
        console.error(`Failed to enrich ${sessionPath}: ${err}`);
      }
    }

    result.message = formatMaintainResult(result);
  }

  return result;
}

async function findSessionsToEnrich(
  cli: ObsidianCLI,
  project: string,
  specificSession?: string
): Promise<string[]> {
  if (specificSession) {
    const content = await cli.read({ path: specificSession });
    if (content.includes("enriched: true")) return [];
    return [specificSession];
  }

  const results = await cli.search(project, {
    path: `Memory/Sessions/${project}/`,
    limit: 10,
  });

  const unenriched: string[] = [];
  for (const result of results) {
    try {
      const content = await cli.read({ path: result.path });
      if (!content.includes("enriched: true")) {
        unenriched.push(result.path);
      }
    } catch {
      // Skip unreadable sessions
    }
  }

  return unenriched.slice(0, 1);
}

async function updateSessionFrontmatter(
  cli: ObsidianCLI,
  sessionPath: string,
  enrichment: EnrichmentResult
): Promise<void> {
  const content = await cli.read({ path: sessionPath });

  const additions: string[] = [];
  additions.push("enriched: true");

  if (enrichment.crossLinks.features_touched.length > 0) {
    additions.push("features_touched:");
    for (const f of enrichment.crossLinks.features_touched) {
      additions.push(`  - ${f}`);
    }
  }
  if (enrichment.crossLinks.decisions_made.length > 0) {
    additions.push("decisions_made:");
    for (const d of enrichment.crossLinks.decisions_made) {
      additions.push(`  - ${d}`);
    }
  }
  if (enrichment.crossLinks.topics.length > 0) {
    additions.push("topics:");
    for (const t of enrichment.crossLinks.topics) {
      additions.push(`  - ${t}`);
    }
  }

  const updated = content.replace(
    /^(---\n[\s\S]*?)(---)/m,
    `$1${additions.join("\n")}\n$2`
  );

  await cli.create({
    name: sessionPath,
    content: updated,
    overwrite: true,
  });
}

async function safeRead(cli: ObsidianCLI, path: string): Promise<string> {
  try {
    return await cli.read({ path });
  } catch {
    return "";
  }
}

function formatMaintainResult(result: MaintainResult): string {
  const lines: string[] = [];
  lines.push(`Enriched ${result.sessionsEnriched} session(s).`);
  if (result.featuresCreated.length > 0) {
    lines.push(`  Features created: ${result.featuresCreated.join(", ")}`);
  }
  if (result.decisionsCreated.length > 0) {
    lines.push(`  Decisions created: ${result.decisionsCreated.join(", ")}`);
  }
  if (result.crossLinksAdded > 0) {
    lines.push(`  Cross-links added to ${result.crossLinksAdded} session(s).`);
  }
  if (result.contextDriftWarnings.length > 0) {
    lines.push(`\nContext drift detected:`);
    for (const w of result.contextDriftWarnings) {
      lines.push(`  - ${w}`);
    }
  }
  return lines.join("\n");
}
