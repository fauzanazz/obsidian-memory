import { describe, test, expect } from "bun:test";
import { formatStatus, type StatusResult } from "../../src/commands/status";

describe("status command", () => {
  describe("formatStatus", () => {
    test("formats healthy status", () => {
      const status: StatusResult = {
        configFound: true,
        vault: "TestVault",
        project: "my-app",
        obsidianRunning: true,
        cliAvailable: true,
        obsidianVersion: "1.12.4",
        hybridSearchAvailable: true,
      };

      const output = formatStatus(status);
      expect(output).toContain("TestVault");
      expect(output).toContain("my-app");
      expect(output).toContain("running");
      expect(output).toContain("available");
      expect(output).toContain("hybrid");
    });

    test("formats missing config status", () => {
      const status: StatusResult = {
        configFound: false,
        obsidianRunning: false,
        cliAvailable: false,
        hybridSearchAvailable: false,
      };

      const output = formatStatus(status);
      expect(output).toContain("not found");
      expect(output).toContain("not running");
      expect(output).toContain("not available");
      expect(output).toContain("keyword only");
    });

    test("includes vault health when available", () => {
      const status: StatusResult = {
        configFound: true,
        vault: "V",
        project: "P",
        obsidianRunning: true,
        cliAvailable: true,
        hybridSearchAvailable: false,
        vaultHealthy: false,
        missingFolders: ["Memory/Sessions", "Memory/Journal"],
      };

      const output = formatStatus(status);
      expect(output).toContain("issues");
      expect(output).toContain("Memory/Sessions");
    });
  });
});
