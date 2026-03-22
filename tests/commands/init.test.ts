import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { detectAgents, runInit, formatInitResult, type AgentId } from "../../src/commands/init";
import { readConfig } from "../../src/lib/config";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("init command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-init-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("detectAgents", () => {
    test("detects no agents in empty directory", async () => {
      const agents = await detectAgents(tempDir);
      expect(agents.every((a) => !a.detected)).toBe(true);
    });

    test("detects Claude Code when .claude/ exists", async () => {
      await mkdir(join(tempDir, ".claude"));
      const agents = await detectAgents(tempDir);
      const claude = agents.find((a) => a.id === "claude-code");
      expect(claude?.detected).toBe(true);
    });

    test("detects Cursor when .cursor/ exists", async () => {
      await mkdir(join(tempDir, ".cursor"));
      const agents = await detectAgents(tempDir);
      const cursor = agents.find((a) => a.id === "cursor");
      expect(cursor?.detected).toBe(true);
    });

    test("detects Antigravity when GEMINI.md exists", async () => {
      await Bun.write(join(tempDir, "GEMINI.md"), "# Gemini");
      const agents = await detectAgents(tempDir);
      const ag = agents.find((a) => a.id === "antigravity");
      expect(ag?.detected).toBe(true);
    });

    test("detects OpenCode when .opencode/ exists", async () => {
      await mkdir(join(tempDir, ".opencode"));
      const agents = await detectAgents(tempDir);
      const oc = agents.find((a) => a.id === "opencode");
      expect(oc?.detected).toBe(true);
    });

    test("detects ForgeCode when forge.yaml exists", async () => {
      await Bun.write(join(tempDir, "forge.yaml"), "model: test");
      const agents = await detectAgents(tempDir);
      const fc = agents.find((a) => a.id === "forgecode");
      expect(fc?.detected).toBe(true);
    });
  });

  describe("runInit", () => {
    test("writes .obsidian-memory.json", async () => {
      await runInit(tempDir, {
        vault: "TestVault",
        project: "test-app",
        agents: [],
      });

      const config = await readConfig(tempDir);
      expect(config).not.toBeNull();
      expect(config!.vault).toBe("TestVault");
      expect(config!.project).toBe("test-app");
    });

    test("generates AGENTS.md", async () => {
      await runInit(tempDir, {
        vault: "TestVault",
        project: "test-app",
        agents: [],
      });

      const agentsMd = await Bun.file(join(tempDir, "AGENTS.md")).text();
      expect(agentsMd).toContain("obsidian-memory");
      expect(agentsMd).toContain("TestVault");
      expect(agentsMd).toContain("test-app");
      expect(agentsMd).toContain("load-context");
      expect(agentsMd).toContain("save-session");
    });

    test("appends to existing AGENTS.md", async () => {
      const existingContent = "# My Project Agents\n\nSome existing agent instructions.";
      await Bun.write(join(tempDir, "AGENTS.md"), existingContent);

      await runInit(tempDir, {
        vault: "TestVault",
        project: "test-app",
        agents: [],
      });

      const agentsMd = await Bun.file(join(tempDir, "AGENTS.md")).text();
      expect(agentsMd).toStartWith("# My Project Agents");
      expect(agentsMd).toContain("Some existing agent instructions.");
      expect(agentsMd).toContain("obsidian-memory");
      expect(agentsMd).toContain("TestVault");
    });

    test("skips AGENTS.md if obsidian-memory already configured", async () => {
      const existingContent = "# Agents\n\nAlready has obsidian-memory config.";
      await Bun.write(join(tempDir, "AGENTS.md"), existingContent);

      const { agentsMdWritten } = await runInit(tempDir, {
        vault: "TestVault",
        project: "test-app",
        agents: [],
      });

      const agentsMd = await Bun.file(join(tempDir, "AGENTS.md")).text();
      expect(agentsMd).toBe(existingContent);
      expect(agentsMdWritten).toBe(false);
    });

    test("generates Claude Code config", async () => {
      const result = await runInit(tempDir, {
        vault: "V",
        project: "P",
        agents: ["claude-code"],
      });

      expect(result.agentConfigs).toHaveLength(1);
      expect(result.agentConfigs[0].agent).toBe("claude-code");

      const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
      expect(content).toContain("AGENTS.md");
    });

    test("generates Cursor config", async () => {
      const result = await runInit(tempDir, {
        vault: "V",
        project: "P",
        agents: ["cursor"],
      });

      const content = await Bun.file(join(tempDir, ".cursor/rules/memory.mdc")).text();
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain("obsidian-memory");
    });

    test("generates OpenCode config with instructions", async () => {
      await runInit(tempDir, {
        vault: "V",
        project: "P",
        agents: ["opencode"],
      });

      const config = await Bun.file(join(tempDir, "opencode.json")).json();
      expect(config.instructions).toContain("AGENTS.md");
    });

    test("merges with existing OpenCode config", async () => {
      await Bun.write(
        join(tempDir, "opencode.json"),
        JSON.stringify({ model: "test-model", instructions: ["CONTRIBUTING.md"] })
      );

      await runInit(tempDir, {
        vault: "V",
        project: "P",
        agents: ["opencode"],
      });

      const config = await Bun.file(join(tempDir, "opencode.json")).json();
      expect(config.model).toBe("test-model");
      expect(config.instructions).toContain("CONTRIBUTING.md");
      expect(config.instructions).toContain("AGENTS.md");
    });

    test("generates ForgeCode config", async () => {
      await runInit(tempDir, {
        vault: "V",
        project: "P",
        agents: ["forgecode"],
      });

      const content = await Bun.file(join(tempDir, "forge.yaml")).text();
      expect(content).toContain("AGENTS.md");
    });

    test("creates vault structure when vaultPath provided", async () => {
      const vaultDir = join(tempDir, "vault");
      await mkdir(vaultDir);

      const result = await runInit(tempDir, {
        vault: "V",
        project: "my-app",
        agents: [],
        vaultPath: vaultDir,
      });

      expect(result.vaultStructureCreated).toBe(true);
      expect(result.vaultFolders).toBeGreaterThan(0);
      expect(result.vaultFiles).toBeGreaterThan(0);

      // Check that vault structure exists
      const indexFile = Bun.file(join(vaultDir, "Memory/Index.md"));
      expect(await indexFile.exists()).toBe(true);

      const contextFile = Bun.file(join(vaultDir, "Memory/Projects/my-app/context.md"));
      expect(await contextFile.exists()).toBe(true);
    });

    test("generates all agent configs at once", async () => {
      const allAgents: AgentId[] = ["claude-code", "cursor", "antigravity", "opencode", "forgecode"];
      const result = await runInit(tempDir, {
        vault: "V",
        project: "P",
        agents: allAgents,
      });

      expect(result.agentConfigs).toHaveLength(5);
    });
  });

  describe("formatInitResult", () => {
    test("formats successful result", () => {
      const output = formatInitResult({
        configWritten: true,
        agentsMdWritten: true,
        agentConfigs: [
          { agent: "claude-code", path: "CLAUDE.md" },
          { agent: "cursor", path: ".cursor/rules/memory.mdc" },
        ],
        vaultStructureCreated: true,
        vaultFolders: 7,
        vaultFiles: 8,
      });

      expect(output).toContain("initialized successfully");
      expect(output).toContain("CLAUDE.md");
      expect(output).toContain("memory.mdc");
      expect(output).toContain("7 folders");
    });
  });
});
