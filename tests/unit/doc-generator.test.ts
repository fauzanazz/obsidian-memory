import { describe, test, expect } from "bun:test";
import {
  generateArchitecture,
  generateFeatures,
  generateModules,
  generateConventions,
  mergeWithExisting,
  AUTO_START,
  AUTO_END,
} from "../../src/lib/doc-generator";
import type { ScanResult, DirectoryNode } from "../../src/lib/scanner";
import type { ProjectInfo } from "../../src/lib/project-detector";

function makeScanResult(): ScanResult {
  return {
    files: [
      "src/index.ts",
      "src/lib/config.ts",
      "src/lib/vault.ts",
      "src/commands/init.ts",
      "src/commands/status.ts",
      "package.json",
    ],
    tree: {
      name: ".",
      files: ["package.json"],
      children: [
        {
          name: "src",
          files: ["index.ts"],
          children: [
            {
              name: "lib",
              files: ["config.ts", "vault.ts"],
              children: [],
            },
            {
              name: "commands",
              files: ["init.ts", "status.ts"],
              children: [],
            },
          ],
        },
      ],
    },
    rootDir: "/tmp/test",
  };
}

function makeProjectInfo(): ProjectInfo {
  return {
    type: "node",
    entryPoints: [
      { path: "src/index.ts", source: "package.json:main" },
    ],
    modules: [
      { directory: "src/lib", entryFile: "", fileCount: 2 },
      { directory: "src/commands", entryFile: "", fileCount: 2 },
    ],
  };
}

describe("generateArchitecture", () => {
  test("includes frontmatter with project name", () => {
    const content = generateArchitecture("my-project", makeScanResult(), makeProjectInfo());
    expect(content).toContain("project: my-project");
    expect(content).toContain("type: documentation");
  });

  test("includes file tree in auto section", () => {
    const content = generateArchitecture("my-project", makeScanResult(), makeProjectInfo());
    expect(content).toContain(AUTO_START("structure"));
    expect(content).toContain(AUTO_END("structure"));
    expect(content).toContain("src/");
    expect(content).toContain("index.ts");
  });

  test("includes entry points in auto section", () => {
    const content = generateArchitecture("my-project", makeScanResult(), makeProjectInfo());
    expect(content).toContain(AUTO_START("entry-points"));
    expect(content).toContain("src/index.ts");
    expect(content).toContain("package.json:main");
  });

  test("includes wikilinks to sibling docs", () => {
    const content = generateArchitecture("my-project", makeScanResult(), makeProjectInfo());
    expect(content).toContain("[[Features]]");
    expect(content).toContain("[[Modules]]");
    expect(content).toContain("[[Conventions]]");
  });
});

describe("generateFeatures", () => {
  test("creates empty feature inventory", () => {
    const content = generateFeatures("my-project");
    expect(content).toContain("# Features");
    expect(content).toContain("Feature");
    expect(content).toContain("Module");
  });

  test("includes instructions for agents", () => {
    const content = generateFeatures("my-project");
    expect(content).toContain("Before creating new functionality");
  });
});

describe("generateModules", () => {
  test("includes module table in auto section", () => {
    const content = generateModules("my-project", makeProjectInfo());
    expect(content).toContain(AUTO_START("modules"));
    expect(content).toContain("src/lib");
    expect(content).toContain("src/commands");
  });

  test("includes file counts", () => {
    const content = generateModules("my-project", makeProjectInfo());
    expect(content).toContain("2");
  });
});

describe("generateConventions", () => {
  test("creates empty conventions template", () => {
    const content = generateConventions("my-project");
    expect(content).toContain("# Conventions");
    expect(content).toContain("Coding Patterns");
    expect(content).toContain("Naming Conventions");
  });
});

describe("mergeWithExisting", () => {
  test("replaces auto sections while preserving agent content", () => {
    const existing = `# Architecture

${AUTO_START("structure")}
old file tree
${AUTO_END("structure")}

## System Overview
Agent wrote this important content that should be preserved.

${AUTO_START("entry-points")}
old entry points
${AUTO_END("entry-points")}
`;

    const newContent = `# Architecture

${AUTO_START("structure")}
new file tree
${AUTO_END("structure")}

## System Overview
<!-- Agent: describe how the system works -->

${AUTO_START("entry-points")}
new entry points
${AUTO_END("entry-points")}
`;

    const merged = mergeWithExisting(newContent, existing);

    // Auto sections should be updated
    expect(merged).toContain("new file tree");
    expect(merged).not.toContain("old file tree");
    expect(merged).toContain("new entry points");
    expect(merged).not.toContain("old entry points");

    // Agent-written content should be preserved
    expect(merged).toContain("Agent wrote this important content");
  });

  test("returns new content when no existing content", () => {
    const newContent = "# Fresh doc";
    const merged = mergeWithExisting(newContent, "");
    expect(merged).toBe(newContent);
  });

  test("handles existing content with no auto sections", () => {
    const existing = "# Architecture\n\nAll agent-written content.";
    const newContent = `# Architecture\n\n${AUTO_START("structure")}\nnew tree\n${AUTO_END("structure")}`;

    const merged = mergeWithExisting(newContent, existing);
    // Should use new content since existing has no matching sections
    expect(merged).toContain("new tree");
  });
});
