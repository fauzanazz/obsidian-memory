import { findConfig, openStore } from "../lib/config";
import type { EventResult } from "../lib/types";

export interface TimelineOptions {
  last?: string;
  since?: string;
  until?: string;
  project?: string;
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
      if (now.getDate() !== day) {
        now.setDate(0);
      }
      break;
    }
  }

  return now.toISOString().split("T")[0];
}

export function formatEventTimeline(events: EventResult[]): string {
  if (events.length === 0) return "No events found.";

  const byDate = new Map<string, EventResult[]>();
  for (const event of events) {
    const group = byDate.get(event.date) ?? [];
    group.push(event);
    byDate.set(event.date, group);
  }

  const lines: string[] = [];
  const sortedDates = Array.from(byDate.keys()).sort().reverse();

  for (const date of sortedDates) {
    lines.push(`## ${date}`);
    for (const event of byDate.get(date)!) {
      const filesStr = event.files
        ? ` (${event.files.split(" ").filter(Boolean).map((f) => "`" + f + "`").join(", ")})`
        : "";
      lines.push(`- **${event.subject}** ${event.action} ${event.object}${filesStr}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function runTimeline(
  cwd: string,
  options: TimelineOptions,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const project = options.project ?? found.config.project;

  const since = options.last ? parseDuration(options.last) : options.since;
  const until = options.until;

  const events = store.getEventsByDate(since, until, project);

  if (events.length === 0) {
    const rangeStr = since ? ` since ${since}` : "";
    store.close();
    return `No events found for project "${project}"${rangeStr}.`;
  }

  const limited = (typeof options.limit === "number" && options.limit > 0)
    ? events.slice(0, options.limit)
    : events;

  const output = `# Timeline — ${project}\n\n${formatEventTimeline(limited)}`;
  store.close();
  return output;
}
