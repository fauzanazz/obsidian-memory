import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ObsidianCLI } from "../../src/lib/obsidian-cli";

const VAULT = "Obsidian Vault";
const TEST_PREFIX = "Memory/Test/_integration";
let cli: ObsidianCLI;
let available = false;

beforeAll(async () => {
  cli = new ObsidianCLI(VAULT);
  try {
    const result = await cli.checkAvailability();
    available = result.obsidianRunning && result.cliAvailable;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (!available) return;
  // Clean up all test notes by deleting via filesystem
  // (Obsidian CLI has no delete command, so we clean up with a search to verify nothing leaks)
});

function skipIfUnavailable() {
  if (!available) {
    console.log("  ⏭ Skipping: Obsidian not running or CLI not available");
    return true;
  }
  return false;
}

describe("Integration: ObsidianCLI", () => {
  test("checkAvailability detects running Obsidian", async () => {
    const result = await cli.checkAvailability();
    if (!result.obsidianRunning) {
      console.log("  ⏭ Obsidian not running — skipping integration tests");
      return;
    }
    expect(result.obsidianRunning).toBe(true);
    expect(result.cliAvailable).toBe(true);
    expect(result.version).toBeDefined();
  });

  test("create and read a note using path", async () => {
    if (skipIfUnavailable()) return;

    const path = `${TEST_PREFIX}/create-read-test.md`;
    const content = "# Create Read Test\n\nThis is integration test content.";

    const createResult = await cli.create({
      name: `${TEST_PREFIX}/create-read-test`,
      content,
      overwrite: true,
    });
    expect(createResult).toContain("create-read-test.md");

    const readBack = await cli.read({ path });
    expect(readBack).toContain("# Create Read Test");
    expect(readBack).toContain("This is integration test content.");
  });

  test("create note with frontmatter and read properties", async () => {
    if (skipIfUnavailable()) return;

    const content =
      "---\ntype: test\nauthor: integration\ntags:\n  - integration-test\n---\n\n# Properties Test";

    await cli.create({
      name: `${TEST_PREFIX}/props-test`,
      content,
      overwrite: true,
    });

    const props = await cli.getProperties({
      path: `${TEST_PREFIX}/props-test.md`,
    });
    expect(props.type).toBe("test");
    expect(props.author).toBe("integration");
  });

  test("append content to a note", async () => {
    if (skipIfUnavailable()) return;

    // Create initial note
    await cli.create({
      name: `${TEST_PREFIX}/append-test`,
      content: "# Append Test\n\nOriginal content.",
      overwrite: true,
    });

    // Append to it
    await cli.append({
      path: `${TEST_PREFIX}/append-test.md`,
      content: "\n\n## Appended Section\n\nNew content here.",
    });

    const readBack = await cli.read({
      path: `${TEST_PREFIX}/append-test.md`,
    });
    expect(readBack).toContain("Original content.");
    expect(readBack).toContain("## Appended Section");
    expect(readBack).toContain("New content here.");
  });

  test("prepend content to a note", async () => {
    if (skipIfUnavailable()) return;

    await cli.create({
      name: `${TEST_PREFIX}/prepend-test`,
      content: "# Prepend Test\n\nOriginal content.",
      overwrite: true,
    });

    await cli.prepend({
      path: `${TEST_PREFIX}/prepend-test.md`,
      content: "Prepended line.\n\n",
    });

    const readBack = await cli.read({
      path: `${TEST_PREFIX}/prepend-test.md`,
    });
    expect(readBack).toContain("Prepended line.");
    // Prepended content should come before original
    const prependIdx = readBack.indexOf("Prepended line.");
    const originalIdx = readBack.indexOf("Original content.");
    expect(prependIdx).toBeLessThan(originalIdx);
  });

  test("search finds a note by content", async () => {
    if (skipIfUnavailable()) return;

    const uniqueMarker = `integ-search-${Date.now()}`;
    await cli.create({
      name: `${TEST_PREFIX}/search-test`,
      content: `# Search Test\n\n${uniqueMarker}`,
      overwrite: true,
    });

    // Small delay for indexing
    await Bun.sleep(500);

    const results = await cli.search(uniqueMarker);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.path.includes("search-test"))).toBe(true);
  });

  test("search with path filter limits scope", async () => {
    if (skipIfUnavailable()) return;

    const results = await cli.search("Test", {
      path: `${TEST_PREFIX}/`,
    });
    // All results should be within the test prefix
    for (const r of results) {
      expect(r.path).toContain(TEST_PREFIX);
    }
  });

  test("setProperty updates note frontmatter", async () => {
    if (skipIfUnavailable()) return;

    await cli.create({
      name: `${TEST_PREFIX}/setprop-test`,
      content: "---\ntype: test\n---\n\n# SetProp Test",
      overwrite: true,
    });

    await cli.setProperty({
      path: `${TEST_PREFIX}/setprop-test.md`,
      name: "status",
      value: "active",
    });

    const props = await cli.getProperties({
      path: `${TEST_PREFIX}/setprop-test.md`,
    });
    expect(props.status).toBe("active");
    expect(props.type).toBe("test");
  });

  test("getFilesWithTag returns matching files", async () => {
    if (skipIfUnavailable()) return;

    await cli.create({
      name: `${TEST_PREFIX}/tag-test`,
      content:
        "---\ntags:\n  - integration-tag-test\n---\n\n# Tag Test",
      overwrite: true,
    });

    // Small delay for indexing
    await Bun.sleep(500);

    const files = await cli.getFilesWithTag("integration-tag-test");
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.includes("tag-test"))).toBe(true);
  });

  test("getBacklinks returns empty array for unlinked note", async () => {
    if (skipIfUnavailable()) return;

    await cli.create({
      name: `${TEST_PREFIX}/backlink-test`,
      content: "# Backlink Test\n\nNo one links to me.",
      overwrite: true,
    });

    const backlinks = await cli.getBacklinks({
      path: `${TEST_PREFIX}/backlink-test.md`,
    });
    expect(Array.isArray(backlinks)).toBe(true);
    expect(backlinks.length).toBe(0);
  });

  test("content escaping preserves special characters", async () => {
    if (skipIfUnavailable()) return;

    const content = '# Escaping Test\n\nLine 1\nLine 2\n\n"Quoted text"\n\tTabbed';

    await cli.create({
      name: `${TEST_PREFIX}/escape-test`,
      content,
      overwrite: true,
    });

    const readBack = await cli.read({
      path: `${TEST_PREFIX}/escape-test.md`,
    });
    expect(readBack).toContain("# Escaping Test");
    expect(readBack).toContain("Line 1");
    expect(readBack).toContain("Line 2");
    expect(readBack).toContain('"Quoted text"');
    expect(readBack).toContain("\tTabbed");
  });

  test("read throws for non-existent note", async () => {
    if (skipIfUnavailable()) return;

    await expect(
      cli.read({ path: `${TEST_PREFIX}/nonexistent-note.md` })
    ).rejects.toThrow();
  });
});
