import { describe, test, expect } from "bun:test";
import {
  detectProjectType,
  detectEntryPoints,
  detectModules,
  type ProjectInfo,
} from "../../src/lib/project-detector";

describe("detectProjectType", () => {
  test("detects node project from package.json", () => {
    const files = ["package.json", "src/index.ts"];
    expect(detectProjectType(files)).toBe("node");
  });

  test("detects python project from pyproject.toml", () => {
    const files = ["pyproject.toml", "src/main.py"];
    expect(detectProjectType(files)).toBe("python");
  });

  test("detects rust project from Cargo.toml", () => {
    const files = ["Cargo.toml", "src/main.rs"];
    expect(detectProjectType(files)).toBe("rust");
  });

  test("returns unknown for unrecognized projects", () => {
    const files = ["README.md", "data.csv"];
    expect(detectProjectType(files)).toBe("unknown");
  });

  test("prefers node over python when both present", () => {
    const files = ["package.json", "pyproject.toml"];
    expect(detectProjectType(files)).toBe("node");
  });
});

describe("detectEntryPoints", () => {
  test("detects main from real package.json", async () => {
    // Use this project's own package.json
    const rootDir = import.meta.dir + "/../..";
    const files = ["package.json", "src/index.ts"];
    const entries = await detectEntryPoints(rootDir, files, "node");

    expect(entries.length).toBeGreaterThan(0);
    // Should find at least main or bin
    const sources = entries.map((e) => e.source);
    expect(
      sources.some((s) => s.startsWith("package.json:"))
    ).toBe(true);
  });

  test("returns empty for unknown project type", async () => {
    const entries = await detectEntryPoints("/tmp", ["README.md"], "unknown");
    expect(entries).toEqual([]);
  });

  test("detects rust entry points", async () => {
    const files = ["Cargo.toml", "src/main.rs", "src/lib.rs"];
    const entries = await detectEntryPoints("/tmp", files, "rust");

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.path)).toContain("src/main.rs");
    expect(entries.map((e) => e.path)).toContain("src/lib.rs");
  });

  test("detects python entry points", async () => {
    const files = ["pyproject.toml", "main.py", "app.py"];
    const entries = await detectEntryPoints("/tmp", files, "python");

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.path)).toContain("main.py");
    expect(entries.map((e) => e.path)).toContain("app.py");
  });
});

describe("detectModules", () => {
  test("detects modules from index files", () => {
    const files = [
      "src/commands/init.ts",
      "src/commands/status.ts",
      "src/lib/config.ts",
      "src/lib/vault.ts",
      "src/lib/scanner.ts",
      "src/index.ts",
    ];

    const modules = detectModules(files);

    const commandsModule = modules.find((m) => m.directory === "src/commands");
    expect(commandsModule).toBeDefined();
    expect(commandsModule!.fileCount).toBe(2);

    const libModule = modules.find((m) => m.directory === "src/lib");
    expect(libModule).toBeDefined();
    expect(libModule!.fileCount).toBe(3);
  });

  test("detects python modules from __init__.py", () => {
    const files = [
      "src/models/__init__.py",
      "src/models/user.py",
      "src/models/post.py",
      "src/utils/__init__.py",
      "src/utils/helpers.py",
    ];

    const modules = detectModules(files);

    const modelsModule = modules.find((m) => m.directory === "src/models");
    expect(modelsModule).toBeDefined();
    expect(modelsModule!.entryFile).toBe("__init__.py");

    const utilsModule = modules.find((m) => m.directory === "src/utils");
    expect(utilsModule).toBeDefined();
  });

  test("detects rust modules from mod.rs", () => {
    const files = [
      "src/handlers/mod.rs",
      "src/handlers/auth.rs",
      "src/handlers/api.rs",
    ];

    const modules = detectModules(files);

    const handlersModule = modules.find((m) => m.directory === "src/handlers");
    expect(handlersModule).toBeDefined();
    expect(handlersModule!.entryFile).toBe("mod.rs");
  });

  test("detects directories with 3+ files as implicit modules", () => {
    const files = [
      "src/utils/a.ts",
      "src/utils/b.ts",
      "src/utils/c.ts",
    ];

    const modules = detectModules(files);

    const utilsModule = modules.find((m) => m.directory === "src/utils");
    expect(utilsModule).toBeDefined();
    expect(utilsModule!.entryFile).toBe("");
    expect(utilsModule!.fileCount).toBe(3);
  });

  test("skips directories with fewer than 2 files and no entry file", () => {
    const files = ["src/random/one-file.ts"];

    const modules = detectModules(files);
    expect(modules.find((m) => m.directory === "src/random")).toBeUndefined();
  });

  test("handles empty file list", () => {
    expect(detectModules([])).toEqual([]);
  });
});
