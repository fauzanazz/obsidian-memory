import { describe, test, expect } from "bun:test";
import { buildTree, type DirectoryNode } from "../../src/lib/scanner";

describe("buildTree", () => {
  test("builds tree from flat file list", () => {
    const files = [
      "src/index.ts",
      "src/lib/config.ts",
      "src/lib/vault.ts",
      "src/commands/init.ts",
      "package.json",
      "README.md",
    ];

    const tree = buildTree(files);

    expect(tree.name).toBe(".");
    expect(tree.files).toContain("package.json");
    expect(tree.files).toContain("README.md");

    const src = tree.children.find((c) => c.name === "src");
    expect(src).toBeDefined();
    expect(src!.files).toContain("index.ts");

    const lib = src!.children.find((c) => c.name === "lib");
    expect(lib).toBeDefined();
    expect(lib!.files).toContain("config.ts");
    expect(lib!.files).toContain("vault.ts");

    const commands = src!.children.find((c) => c.name === "commands");
    expect(commands).toBeDefined();
    expect(commands!.files).toContain("init.ts");
  });

  test("handles empty file list", () => {
    const tree = buildTree([]);
    expect(tree.name).toBe(".");
    expect(tree.children).toHaveLength(0);
    expect(tree.files).toHaveLength(0);
  });

  test("handles deeply nested files", () => {
    const files = ["a/b/c/d/file.ts"];
    const tree = buildTree(files);

    const a = tree.children.find((c) => c.name === "a");
    const b = a!.children.find((c) => c.name === "b");
    const c = b!.children.find((c) => c.name === "c");
    const d = c!.children.find((c) => c.name === "d");
    expect(d!.files).toContain("file.ts");
  });

  test("sorts children and files alphabetically", () => {
    const files = [
      "src/z.ts",
      "src/a.ts",
      "lib/b.ts",
      "abc/c.ts",
    ];
    const tree = buildTree(files);

    expect(tree.children.map((c) => c.name)).toEqual(["abc", "lib", "src"]);
    const src = tree.children.find((c) => c.name === "src")!;
    expect(src.files).toEqual(["a.ts", "z.ts"]);
  });
});

describe("renderTree", () => {
  // Import dynamically to avoid issues if not yet implemented
  test("renders tree as readable string", async () => {
    const { renderTree } = await import("../../src/lib/scanner");
    const files = [
      "src/index.ts",
      "src/lib/config.ts",
      "package.json",
    ];
    const { buildTree } = await import("../../src/lib/scanner");
    const tree = buildTree(files);
    const rendered = renderTree(tree);

    expect(rendered).toContain("src/");
    expect(rendered).toContain("index.ts");
    expect(rendered).toContain("lib/");
    expect(rendered).toContain("config.ts");
    expect(rendered).toContain("package.json");
  });
});
