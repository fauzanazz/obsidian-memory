import { describe, test, expect } from "bun:test";
import {
  buildEnrichmentPrompt,
  type EnrichmentResult,
} from "../../src/lib/enricher";

describe("buildEnrichmentPrompt", () => {
  test("includes session content in prompt", () => {
    const prompt = buildEnrichmentPrompt(
      "# Session — 2024-01-15\nImplemented auth flow",
      "",
      ""
    );

    expect(prompt).toContain("Implemented auth flow");
  });

  test("includes feature index when provided", () => {
    const featureIndex = "- auth-jwt: JWT authentication\n- user-crud: User CRUD";
    const prompt = buildEnrichmentPrompt("session content", featureIndex, "");

    expect(prompt).toContain("auth-jwt");
    expect(prompt).toContain("user-crud");
  });

  test("includes decision index when provided", () => {
    const decisionIndex = "- ADR-001: Use PostgreSQL\n- ADR-002: Use JWT";
    const prompt = buildEnrichmentPrompt("session content", "", decisionIndex);

    expect(prompt).toContain("ADR-001");
    expect(prompt).toContain("Use PostgreSQL");
  });

  test("uses placeholder when no features exist", () => {
    const prompt = buildEnrichmentPrompt("session content", "", "");

    expect(prompt).toContain("_No features yet._");
  });

  test("uses placeholder when no decisions exist", () => {
    const prompt = buildEnrichmentPrompt("session content", "", "");

    expect(prompt).toContain("_No decisions yet._");
  });

  test("includes extraction rules in prompt", () => {
    const prompt = buildEnrichmentPrompt("session content", "", "");

    expect(prompt).toContain("Return ONLY valid JSON");
    expect(prompt).toContain("features");
    expect(prompt).toContain("decisions");
    expect(prompt).toContain("crossLinks");
    expect(prompt).toContain("contextDrift");
  });
});

describe("EnrichmentResult type", () => {
  test("validates a well-formed enrichment result", () => {
    const result: EnrichmentResult = {
      features: [
        {
          slug: "auth-jwt",
          title: "JWT Authentication",
          summary: "Implemented JWT-based auth flow",
          status: "completed",
          categories: ["auth", "security"],
          keyFiles: [
            { path: "src/auth.ts", role: "main auth module" },
          ],
        },
      ],
      decisions: [
        {
          title: "Use JWT for authentication",
          context: "Needed stateless auth",
          decision: "Chose JWT over sessions",
          categories: ["auth"],
          impacts: ["auth-jwt"],
          alternatives: [
            { name: "Session cookies", proscons: "Simpler but stateful" },
          ],
          consequences: "Need token refresh logic",
        },
      ],
      crossLinks: {
        features_touched: ["auth-jwt"],
        decisions_made: ["Use JWT for authentication"],
        topics: ["authentication", "security"],
      },
      contextDrift: null,
    };

    expect(result.features).toHaveLength(1);
    expect(result.decisions).toHaveLength(1);
    expect(result.crossLinks.features_touched).toContain("auth-jwt");
    expect(result.contextDrift).toBeNull();
  });

  test("validates empty enrichment result", () => {
    const result: EnrichmentResult = {
      features: [],
      decisions: [],
      crossLinks: {
        features_touched: [],
        decisions_made: [],
        topics: [],
      },
      contextDrift: null,
    };

    expect(result.features).toHaveLength(0);
    expect(result.decisions).toHaveLength(0);
  });

  test("validates result with context drift", () => {
    const result: EnrichmentResult = {
      features: [],
      decisions: [],
      crossLinks: {
        features_touched: [],
        decisions_made: [],
        topics: ["testing"],
      },
      contextDrift: "Session adds GraphQL but project context says REST only",
    };

    expect(result.contextDrift).toBeTruthy();
    expect(result.contextDrift).toContain("GraphQL");
  });
});
