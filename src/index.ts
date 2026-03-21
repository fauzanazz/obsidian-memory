#!/usr/bin/env bun

import { Command } from "commander";
import * as p from "@clack/prompts";
import { basename } from "path";
import { runStatus, formatStatus } from "./commands/status";
import { runLoadContext } from "./commands/load-context";
import { runSaveSession } from "./commands/save-session";
import { runSearch, formatSearchResults } from "./commands/search";
import { runConsolidate } from "./commands/consolidate";
import { detectAgents, runInit, formatInitResult, type AgentId } from "./commands/init";

const program = new Command();

program
  .name("obsidian-memory")
  .description("Universal memory layer for AI coding agents, powered by Obsidian")
  .version("0.1.0");

program
  .command("init")
  .description("Set up obsidian-memory for a project (create vault, generate agent configs)")
  .option("--vault <name>", "Obsidian vault name")
  .option("--project <name>", "Project name")
  .option("--vault-path <path>", "Filesystem path to create vault structure")
  .option("--agents <agents...>", "Agents to configure (claude-code, cursor, antigravity, opencode, forgecode)")
  .action(async (opts) => {
    try {
      const cwd = process.cwd();
      const detected = await detectAgents(cwd);

      // Interactive mode when vault or project not provided
      let interactive = false;
      if (!opts.vault || !opts.project) {
        interactive = true;
        p.intro("obsidian-memory setup");

        const detectedNames = detected
          .filter((a) => a.detected)
          .map((a) => a.label)
          .join(", ");
        if (detectedNames) {
          p.note(`Detected agents: ${detectedNames}`);
        }

        const answers = await p.group(
          {
            vault: () =>
              p.text({
                message: "Obsidian vault name",
                placeholder: "ObsidianMemory",
                defaultValue: "ObsidianMemory",
                validate: (v) => (!v ? "Vault name is required" : undefined),
              }),
            project: () =>
              p.text({
                message: "Project name",
                placeholder: basename(cwd),
                defaultValue: basename(cwd),
                validate: (v) => (!v ? "Project name is required" : undefined),
              }),
            vaultPath: () =>
              p.text({
                message: "Vault filesystem path (for creating folder structure)",
                placeholder: `~/ObsidianMemory`,
                defaultValue: "",
              }),
            agents: () =>
              p.multiselect({
                message: "Which agents should be configured?",
                options: detected.map((a) => ({
                  value: a.id,
                  label: a.label,
                  hint: a.detected ? "detected" : undefined,
                })),
                initialValues: detected.filter((a) => a.detected).map((a) => a.id),
                required: true,
              }),
          },
          {
            onCancel: () => {
              p.cancel("Setup cancelled.");
              process.exit(0);
            },
          }
        );

        opts.vault = answers.vault;
        opts.project = answers.project;
        opts.vaultPath = answers.vaultPath || undefined;
        opts.agents = answers.agents;
      }

      const agents: AgentId[] = opts.agents || detected
        .filter((a) => a.detected)
        .map((a) => a.id);

      // Resolve ~ in vault path
      const vaultPath = opts.vaultPath?.replace(/^~/, process.env.HOME || "~");

      const result = await runInit(cwd, {
        vault: opts.vault,
        project: opts.project,
        agents,
        vaultPath,
      });

      console.log(formatInitResult(result));
      if (interactive) {
        p.outro("Done! Open the vault in Obsidian and start coding.");
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Check system health (Obsidian running, vault exists, config valid)")
  .action(async () => {
    const result = await runStatus(process.cwd());
    console.log(formatStatus(result));
  });

program
  .command("load-context")
  .description("Load project context from the memory vault")
  .option("--no-conventions", "Exclude conventions")
  .option("--no-decisions", "Exclude decisions")
  .option("--sessions <n>", "Number of recent sessions to include", "3")
  .action(async (opts) => {
    try {
      const output = await runLoadContext(process.cwd(), {
        includeConventions: opts.conventions !== false,
        includeDecisions: opts.decisions !== false,
        includeSessions: parseInt(opts.sessions, 10),
      });
      console.log(output);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("save-session")
  .description("Save a session summary to the memory vault")
  .requiredOption("--agent <name>", "Agent name (e.g., claude-code, cursor)")
  .requiredOption("--summary <text>", "Session summary")
  .option("--decisions <items...>", "Decisions made during the session")
  .option("--files <items...>", "Files modified during the session")
  .option("--blockers <items...>", "Open blockers or questions")
  .option("--next <items...>", "Next steps")
  .action(async (opts) => {
    try {
      const noteName = await runSaveSession(process.cwd(), {
        agent: opts.agent,
        summary: opts.summary,
        decisions: opts.decisions,
        files: opts.files,
        blockers: opts.blockers,
        nextSteps: opts.next,
      });
      console.log(`Session saved: ${noteName}`);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("search <query>")
  .description("Search memory vault by keyword or semantics")
  .option("--path <path>", "Limit search to a vault path")
  .option("--limit <n>", "Maximum number of results")
  .action(async (query: string, opts) => {
    try {
      const { results, provider } = await runSearch(process.cwd(), query, {
        path: opts.path,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      console.log(formatSearchResults(results, provider));
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("consolidate")
  .description("Merge stale or overlapping memory notes")
  .option("--days <n>", "Consolidate sessions older than N days", "30")
  .option("--auto", "Auto-merge without confirmation")
  .action(async (opts) => {
    try {
      const result = await runConsolidate(process.cwd(), {
        daysThreshold: parseInt(opts.days, 10),
        auto: opts.auto,
      });
      console.log(result.message);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program.parse();
