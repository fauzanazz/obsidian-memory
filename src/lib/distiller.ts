import { callLLMJson } from "./llm";
import type { LLMConfig } from "./llm";

export interface DistillationResult {
  journal: JournalEntry;
  contextUpdates: ContextUpdates | null;
  newDecisions: DecisionExtract[];
  newFeatures: FeatureExtract[];
}

export interface JournalEntry {
  period: string;
  themes: string[];
  accomplishments: string;
  decisionsSummary: string;
  patternsObserved: string;
  outstandingBlockers: string[];
  weeklyBreakdown: Array<{
    week: string;
    highlights: string[];
  }>;
}

export interface ContextUpdates {
  currentState: string | null;
  techStack: string | null;
  architecture: string | null;
}

export interface DecisionExtract {
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface FeatureExtract {
  slug: string;
  title: string;
  summary: string;
  status: "in-progress" | "completed";
}

const DISTILLATION_PROMPT = `You are a technical documentation agent performing knowledge distillation.
You are given a batch of session notes from the same month for the same project. Your job is to
synthesize these into structured knowledge that updates the project's canonical documentation.

## Project Context
{PROJECT_CONTEXT}

## Current Progress
{PROGRESS}

## Existing Feature Index
{FEATURE_INDEX}

## Existing Decision Index
{DECISION_INDEX}

## Sessions to Distill (oldest first)
{SESSIONS}

---

Analyze all sessions and produce a JSON object with these fields:

1. "journal": A rich monthly journal entry:
   - "period": the month (YYYY-MM format)
   - "themes": 3-5 high-level themes that emerged across sessions
   - "accomplishments": one prose paragraph summarizing what was built/achieved
   - "decisionsSummary": one prose paragraph summarizing key decisions and their reasoning
   - "patternsObserved": recurring patterns, conventions, or approaches that solidified
   - "outstandingBlockers": array of blockers mentioned but never resolved
   - "weeklyBreakdown": array of { week: "Week of YYYY-MM-DD", highlights: ["one-liner per session"] }

2. "contextUpdates": Updates to the project canonical docs, or null if nothing changed significantly:
   - "currentState": new "Current State" text reflecting where the project is NOW (or null)
   - "techStack": any tech stack changes to note (or null)
   - "architecture": any architecture changes to note (or null)

3. "newDecisions": Decisions mentioned in sessions not in existing decision index.
   Each: { title, context, decision, consequences }. Only significant architectural/design decisions.

4. "newFeatures": Features implemented in sessions not in existing feature index.
   Each: { slug (kebab-case), title, summary, status }. Only real features, not bugfixes.

Rules:
- Return ONLY valid JSON, no markdown fences
- Be conservative: only extract decisions and features that are genuinely new
- The journal should SYNTHESIZE, not concatenate
- Outstanding blockers are blockers mentioned but never resolved in later sessions
- Weekly breakdown highlights should be one sentence each`;

export async function distillSessions(
  sessions: Array<{ path: string; content: string; date: string }>,
  projectContext: string,
  progress: string,
  featureIndex: string,
  decisionIndex: string,
  llmConfig?: LLMConfig
): Promise<DistillationResult> {
  if (sessions.length === 0) {
    return {
      journal: {
        period: "",
        themes: [],
        accomplishments: "",
        decisionsSummary: "",
        patternsObserved: "",
        outstandingBlockers: [],
        weeklyBreakdown: [],
      },
      contextUpdates: null,
      newDecisions: [],
      newFeatures: [],
    };
  }

  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));

  const sessionsText = sorted
    .map((s) => `### ${s.path.split("/").pop()}\n${s.content}`)
    .join("\n\n---\n\n");

  const prompt = DISTILLATION_PROMPT
    .replace("{PROJECT_CONTEXT}", projectContext || "_No context available._")
    .replace("{PROGRESS}", progress || "_No progress notes._")
    .replace("{FEATURE_INDEX}", featureIndex || "_No features yet._")
    .replace("{DECISION_INDEX}", decisionIndex || "_No decisions yet._")
    .replace("{SESSIONS}", sessionsText);

  return callLLMJson<DistillationResult>(prompt, llmConfig);
}
