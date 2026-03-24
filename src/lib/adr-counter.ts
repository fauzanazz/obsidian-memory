import { ObsidianCLI } from "./obsidian-cli";

/**
 * Get the next ADR number by reading existing ADR notes.
 * Scans Memory/Projects/{project}/ADRs/ for files matching ADR-NNN-*.md
 * Returns max(existing numbers) + 1, or 1 if no ADRs exist.
 */
export async function getNextADRNumber(
  cli: ObsidianCLI,
  project: string
): Promise<number> {
  try {
    const results = await cli.search("ADR-", {
      path: `Memory/Projects/${project}/ADRs/`,
    });

    let maxNumber = 0;
    for (const result of results) {
      const filename = result.path.split("/").pop() || "";
      const match = filename.match(/^ADR-(\d{3})/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }

    return maxNumber + 1;
  } catch {
    // No ADRs directory or no results — start at 1
    return 1;
  }
}

/**
 * Convert a title to a slug for the ADR filename.
 * "JWT Authentication over Session Cookies" → "jwt-authentication-over-session-cookies"
 */
export function titleToSlug(title: string, maxLength = 40): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, maxLength)
    .replace(/-$/, "");
}
