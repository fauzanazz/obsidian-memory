import { findConfig, resolveVaultPath } from "../lib/config";
import { readEvents, formatEventTimeline } from "../lib/event-extractor";

export interface TimelineOptions {
  last?: string;      // duration like "7d", "2w", "1m"
  since?: string;     // ISO date
  until?: string;     // ISO date
  project?: string;   // override project from config
  limit?: number;
}

export function parseDuration(duration: string): string {
  const match = duration.match(/^(\d+)([dwm])$/);
  if (!match) throw new Error(`Invalid duration: ${duration}. Use format like "7d", "2w", "1m".`);

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case "d": now.setDate(now.getDate() - value); break;
    case "w": now.setDate(now.getDate() - value * 7); break;
    case "m": {
      const day = now.getDate();
      now.setMonth(now.getMonth() - value);
      // Clamp to last day of resulting month if overflow occurred
      // (e.g., March 31 → setMonth to Feb → becomes March 3 → clamp to Feb 28)
      if (now.getDate() !== day) {
        now.setDate(0); // back to last day of previous month
      }
      break;
    }
  }

  return now.toISOString().split("T")[0];
}

export async function runTimeline(
  cwd: string,
  options: TimelineOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory.json found. Run `obsidian-memory init` first.");
  }

  const project = options.project ?? found.config.project;
  const vaultPath = resolveVaultPath(found.config);

  if (!vaultPath) {
    throw new Error("Could not resolve vault filesystem path. Set vaultPath in .obsidian-memory.json.");
  }

  const since = options.last ? parseDuration(options.last) : options.since;
  const until = options.until;

  const events = await readEvents(vaultPath, project, { since, until });

  if (events.length === 0) {
    const rangeStr = since ? ` since ${since}` : "";
    return `No events found for project "${project}"${rangeStr}. Events are extracted during save-session when GEMINI_API_KEY is set.`;
  }

  const limited = (typeof options.limit === "number" && options.limit > 0)
    ? events.slice(0, options.limit)
    : events;
  return `# Timeline — ${project}\n\n${formatEventTimeline(limited)}`;
}
