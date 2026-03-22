import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getVaultStructure, validateVaultHealth, VAULT_FOLDERS } from "../../src/lib/vault";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("Vault Structure", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "obsidian-memory-vault-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("VAULT_FOLDERS", () => {
    test("contains required folder paths", () => {
      expect(VAULT_FOLDERS).toContain("Memory");
      expect(VAULT_FOLDERS).toContain("Memory/Projects");
      expect(VAULT_FOLDERS).toContain("Memory/Conventions");
      expect(VAULT_FOLDERS).toContain("Memory/Sessions");
      expect(VAULT_FOLDERS).toContain("Memory/Journal");
      expect(VAULT_FOLDERS).toContain("Memory/Templates");
    });
  });

  describe("getVaultStructure", () => {
    test("returns folder and file definitions", () => {
      const structure = getVaultStructure("test-project");
      expect(structure.folders.length).toBeGreaterThan(0);
      expect(structure.files.length).toBeGreaterThan(0);

      // Should include project-specific folders
      expect(structure.folders).toContain("Memory/Projects/test-project");
      expect(structure.folders).toContain("Memory/Sessions/test-project");

      // Should include Index.md
      const indexFile = structure.files.find((f) => f.path === "Memory/Index.md");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain("Index");
    });

    test("includes template files", () => {
      const structure = getVaultStructure("my-app");
      const templatePaths = structure.files.map((f) => f.path);
      expect(templatePaths).toContain("Memory/Templates/session.md");
      expect(templatePaths).toContain("Memory/Templates/project.md");
      expect(templatePaths).toContain("Memory/Templates/decision.md");
    });

    test("includes project context files", () => {
      const structure = getVaultStructure("my-app");
      const filePaths = structure.files.map((f) => f.path);
      expect(filePaths).toContain("Memory/Projects/my-app/context.md");
      expect(filePaths).toContain("Memory/Projects/my-app/decisions.md");
      expect(filePaths).toContain("Memory/Projects/my-app/progress.md");
    });
  });

  describe("validateVaultHealth", () => {
    test("reports all folders missing for empty directory", async () => {
      const health = await validateVaultHealth(tempDir);
      expect(health.healthy).toBe(false);
      expect(health.missingFolders.length).toBeGreaterThan(0);
      expect(health.missingFolders).toContain("Memory");
    });

    test("reports healthy when all folders exist", async () => {
      for (const folder of VAULT_FOLDERS) {
        await mkdir(join(tempDir, folder), { recursive: true });
      }

      const health = await validateVaultHealth(tempDir);
      expect(health.healthy).toBe(true);
      expect(health.missingFolders).toHaveLength(0);
    });

    test("reports specific missing folders", async () => {
      await mkdir(join(tempDir, "Memory"), { recursive: true });
      await mkdir(join(tempDir, "Memory/Projects"), { recursive: true });

      const health = await validateVaultHealth(tempDir);
      expect(health.healthy).toBe(false);
      expect(health.missingFolders).not.toContain("Memory");
      expect(health.missingFolders).not.toContain("Memory/Projects");
      expect(health.missingFolders).toContain("Memory/Sessions");
    });
  });
});
