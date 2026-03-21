import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readConfig, writeConfig, findConfig, type MemoryConfig } from "../../src/lib/config";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("Config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("writeConfig", () => {
    test("writes .obsidian-memory.json to a directory", async () => {
      const config: MemoryConfig = {
        vault: "ObsidianMemory",
        project: "my-app",
        agents: ["claude-code", "cursor"],
      };

      await writeConfig(tempDir, config);

      const file = Bun.file(join(tempDir, ".obsidian-memory.json"));
      expect(await file.exists()).toBe(true);

      const written = await file.json();
      expect(written.vault).toBe("ObsidianMemory");
      expect(written.project).toBe("my-app");
      expect(written.agents).toEqual(["claude-code", "cursor"]);
    });
  });

  describe("readConfig", () => {
    test("reads .obsidian-memory.json from a directory", async () => {
      const config: MemoryConfig = {
        vault: "TestVault",
        project: "test-project",
        agents: ["claude-code"],
      };
      await writeConfig(tempDir, config);

      const result = await readConfig(tempDir);
      expect(result).not.toBeNull();
      expect(result!.vault).toBe("TestVault");
      expect(result!.project).toBe("test-project");
    });

    test("returns null when config does not exist", async () => {
      const result = await readConfig(tempDir);
      expect(result).toBeNull();
    });
  });

  describe("findConfig", () => {
    test("finds config in current directory", async () => {
      const config: MemoryConfig = {
        vault: "TestVault",
        project: "test",
        agents: [],
      };
      await writeConfig(tempDir, config);

      const result = await findConfig(tempDir);
      expect(result).not.toBeNull();
      expect(result!.config.vault).toBe("TestVault");
      expect(result!.dir).toBe(tempDir);
    });

    test("finds config in parent directory", async () => {
      const config: MemoryConfig = {
        vault: "ParentVault",
        project: "parent",
        agents: [],
      };
      await writeConfig(tempDir, config);

      const subDir = join(tempDir, "src", "lib");
      await Bun.write(join(subDir, ".keep"), "");

      const result = await findConfig(subDir);
      expect(result).not.toBeNull();
      expect(result!.config.vault).toBe("ParentVault");
      expect(result!.dir).toBe(tempDir);
    });

    test("returns null when no config found", async () => {
      const result = await findConfig(tempDir);
      expect(result).toBeNull();
    });
  });
});
