import { callLLMJson } from "./llm";
import type { LLMConfig } from "./config";

export interface EnrichmentResult {
  features: Array<{
    slug: string;
    title: string;
    summary: string;
    status: "draft" | "in-progress" | "completed";
    categories: string[];
    keyFiles: Array<{ path: string; role: string }>;
  }>;
  decisions: Array<{
    title: string;
    context: string;
    decision: string;
    categories: string[];
    impacts: string[];
    alternatives: Array<{ name: string; proscons: string }>;
    consequences: string;
  }>;
  crossLinks: {
    features_touched: string[];
    decisions_made: string[];
    topics: string[];
  };
  contextDrift: string | null;
}

const ENRICHMENT_PROMPT = `You are a technical documentation agent. Analyze this session note and extract structured information.

## Session Note
{SESSION_CONTENT}

## Existing Features
{FEATURE_INDEX}

## Existing Decisions
{DECISION_INDEX}

---

Extract the following as JSON:

1. "features": New features implemented or significantly modified in this session. Only include features that don't already exist in the feature index. Each needs: slug (kebab-case), title, summary (one sentence), status, categories (domain tags), keyFiles (path + role).

2. "decisions": Significant technical decisions made (architecture, library choices, design patterns). Only include non-trivial decisions — not "used a for loop". Each needs: title, context (problem), decision (what was chosen), categories, impacts (feature slugs affected), alternatives (name + pros/cons/why rejected), consequences.

3. "crossLinks": { features_touched (slugs of ALL features this session touched, including existing ones), decisions_made (titles of decisions), topics (2-5 topic keywords like "authentication", "database", "testing") }

4. "contextDrift": If the session's work seems to contradict or go beyond what the project context describes, return a one-sentence warning. Otherwise null.

Rules:
- Return ONLY valid JSON, no markdown fences
- If no features/decisions were found, return empty arrays
- Prefer updating existing features over creating new ones (check the index)
- Slug format: lowercase, hyphens, max 30 chars (e.g., "auth-jwt", "todo-crud")
- Be conservative: only extract real features and real decisions, not trivial changes`;

export function buildEnrichmentPrompt(
  sessionContent: string,
  featureIndex: string,
  decisionIndex: string
): string {
  const replacements: Record<string, string> = {
    "{SESSION_CONTENT}": sessionContent,
    "{FEATURE_INDEX}": featureIndex || "_No features yet._",
    "{DECISION_INDEX}": decisionIndex || "_No decisions yet._",
  };

  return ENRICHMENT_PROMPT.replace(
    /\{SESSION_CONTENT\}|\{FEATURE_INDEX\}|\{DECISION_INDEX\}/g,
    (token) => replacements[token]
  );
}

export async function enrichSession(
  sessionContent: string,
  featureIndex: string,
  decisionIndex: string,
  llmConfig?: LLMConfig
): Promise<EnrichmentResult> {
  const prompt = buildEnrichmentPrompt(sessionContent, featureIndex, decisionIndex);
  return callLLMJson<EnrichmentResult>(prompt, llmConfig);
}
