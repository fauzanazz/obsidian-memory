import { describe, test, expect } from "bun:test";
import { formatDocumentResult, type DocumentResult } from "../../src/commands/document";

describe("formatDocumentResult", () => {
  test("formats result with created docs", () => {
    const result: DocumentResult = {
      created: ["Architecture", "Features", "Modules", "Conventions"],
      updated: [],
      project: "my-project",
    };

    const output = formatDocumentResult(result);
    expect(output).toContain("my-project");
    expect(output).toContain("Created: Architecture, Features, Modules, Conventions");
    expect(output).toContain("Memory/Projects/my-project/Docs/");
  });

  test("formats result with updated docs", () => {
    const result: DocumentResult = {
      created: [],
      updated: ["Architecture", "Modules"],
      project: "test-proj",
    };

    const output = formatDocumentResult(result);
    expect(output).toContain("Updated: Architecture, Modules");
  });

  test("formats result with mix of created and updated", () => {
    const result: DocumentResult = {
      created: ["Features", "Conventions"],
      updated: ["Architecture", "Modules"],
      project: "test",
    };

    const output = formatDocumentResult(result);
    expect(output).toContain("Created: Features, Conventions");
    expect(output).toContain("Updated: Architecture, Modules");
  });
});
