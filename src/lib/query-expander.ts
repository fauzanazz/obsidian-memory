/**
 * Query expander — shared utility that sits in front of all retrieval operations.
 *
 * With API key: expands raw queries into richer search terms via cheap LLM call.
 * Without API key: splits on whitespace (passthrough). No degradation in availability,
 * only in recall on vocabulary mismatch.
 */

import { callLLMJson } from "./llm";
import type { ExpandedQuery, LLMConfig } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const EXPAND_PROMPT = `Given this search query about a coding project's history, generate search terms that would find relevant results. Include synonyms and related technical terms to handle vocabulary mismatch.

Query: "{QUERY}"

Return JSON: { "terms": ["3-5 keywords"], "timeframe": "recent|all" }
Only JSON, no fences.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function expandQuery(
  rawQuery: string,
  apiKey?: string,
  llmConfig?: LLMConfig,
): Promise<ExpandedQuery> {
  const fallback: ExpandedQuery = {
    terms: rawQuery.split(/\s+/).filter(Boolean),
    original: rawQuery,
  };

  if (!apiKey) return fallback;

  try {
    const prompt = EXPAND_PROMPT.replace("{QUERY}", rawQuery);
    const result = await callLLMJson<{
      terms: string[];
      timeframe: "recent" | "all";
    }>(prompt, llmConfig);

    if (!Array.isArray(result.terms) || result.terms.length === 0) {
      return fallback;
    }

    return {
      terms: result.terms.slice(0, 5),
      timeframe:
        result.timeframe === "recent" ? { since: daysAgo(14) } : undefined,
      original: rawQuery,
    };
  } catch {
    return fallback;
  }
}
