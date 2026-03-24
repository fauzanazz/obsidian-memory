import { ObsidianCLI } from "../lib/obsidian-cli";
import { findConfig } from "../lib/config";
import { adrNote, type ADRNoteOptions } from "../templates/note-templates";
import { getNextADRNumber, titleToSlug } from "../lib/adr-counter";

export interface SaveDecisionOptions {
  title: string;
  context: string;
  decision: string;
  status?: string;
  categories?: string[];
  impacts?: string[];
  supersedes?: number;
  alternatives?: string[]; // "Name: description" format from CLI
  consequences?: string;
}

export async function runSaveDecision(
  cwd: string,
  options: SaveDecisionOptions
): Promise<{ notePath: string; adrNumber: number }> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error(
      "No .obsidian-memory.json found. Run `obsidian-memory init` first."
    );
  }

  const { vault, project } = found.config;
  const cli = new ObsidianCLI(vault);

  const adrNumber = await getNextADRNumber(cli, project);
  const date = new Date().toISOString().split("T")[0];
  const slug = titleToSlug(options.title);
  const num = String(adrNumber).padStart(3, "0");

  // Parse alternatives from "Name: description" strings
  const alternatives = options.alternatives?.map((alt) => {
    const colonIdx = alt.indexOf(":");
    if (colonIdx > 0) {
      return {
        name: alt.slice(0, colonIdx).trim(),
        proscons: alt.slice(colonIdx + 1).trim(),
      };
    }
    return { name: alt, proscons: "" };
  });

  const status = (options.status || "accepted") as ADRNoteOptions["status"];

  const content = adrNote({
    project,
    adrNumber,
    title: options.title,
    date,
    status,
    categories: options.categories,
    supersedes: options.supersedes,
    impacts: options.impacts,
    context: options.context,
    decision: options.decision,
    alternatives,
    consequences: options.consequences,
  });

  const notePath = `Memory/Projects/${project}/ADRs/ADR-${num}-${slug}.md`;

  await cli.create({
    name: notePath.replace(/\.md$/, ""),
    content,
    silent: true,
  });

  // Update decisions.md index: prepend a wikilink after the header
  try {
    await cli.prepend({
      path: `Memory/Projects/${project}/decisions.md`,
      content: `\n- [[ADRs/ADR-${num}-${slug}|ADR-${num}: ${options.title}]] — ${status} (${date})\n`,
    });
  } catch {
    // decisions.md may not exist yet — not critical
  }

  // If supersedes is set, update the superseded ADR's frontmatter
  if (options.supersedes) {
    const supersededNum = String(options.supersedes).padStart(3, "0");
    try {
      const searchResults = await cli.search(`ADR-${supersededNum}`, {
        path: `Memory/Projects/${project}/ADRs/`,
      });
      if (searchResults.length > 0) {
        const oldAdrPath = searchResults[0].path;
        await cli.setProperty({
          path: oldAdrPath,
          name: "superseded_by",
          value: String(adrNumber),
        });
        await cli.setProperty({
          path: oldAdrPath,
          name: "status",
          value: "superseded",
        });
      }
    } catch {
      // Best effort — don't fail the whole command if we can't update the old ADR
    }
  }

  return { notePath, adrNumber };
}
