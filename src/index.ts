#!/usr/bin/env bun

import { Command } from "commander";

const program = new Command();

program
  .name("obsidian-memory")
  .description("Universal memory layer for AI coding agents, powered by Obsidian")
  .version("0.1.0");

program
  .command("init")
  .description("Set up obsidian-memory for a project (create vault, generate agent configs)")
  .action(() => {
    console.log("init: not yet implemented");
  });

program
  .command("status")
  .description("Check system health (Obsidian running, vault exists, config valid)")
  .action(() => {
    console.log("status: not yet implemented");
  });

program
  .command("load-context")
  .description("Load project context from the memory vault")
  .action(() => {
    console.log("load-context: not yet implemented");
  });

program
  .command("save-session")
  .description("Save a session summary to the memory vault")
  .action(() => {
    console.log("save-session: not yet implemented");
  });

program
  .command("search <query>")
  .description("Search memory vault by keyword or semantics")
  .action((query: string) => {
    console.log(`search: not yet implemented (query: ${query})`);
  });

program
  .command("consolidate")
  .description("Merge stale or overlapping memory notes")
  .action(() => {
    console.log("consolidate: not yet implemented");
  });

program.parse();
