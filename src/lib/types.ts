/**
 * Shared types for obsidian-memory v2.
 *
 * All storage types are defined here. Domain-specific types (enrichment prompts,
 * distillation results) stay in their respective modules.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LLMConfig {
  provider: "gemini" | "anthropic" | "openai";
  model: string;
  apiKeyEnv: string;
}

export interface MemoryConfig {
  project: string;
  agents: string[];
  /** Optional: only needed for `sync` command (Obsidian export) */
  vault?: string;
  /** Optional: filesystem path to Obsidian vault for `sync` */
  vaultPath?: string;
  llm?: LLMConfig;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SaveSessionOptions {
  project: string;
  agent: string;
  date: string;
  summary: string;
  content: string;
  files?: string[];
  decisions?: string[];
  blockers?: string[];
  nextSteps?: string[];
}

export interface Session {
  id: string;
  project: string;
  agent: string;
  date: string;
  summary: string;
  content: string;
  files: string[];
  decisions: string[];
  blockers: string[];
  nextSteps: string[];
  archived: boolean;
  enriched: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Events (temporal index)
// ---------------------------------------------------------------------------

export interface EventRecord {
  project: string;
  sessionId: string;
  date: string;
  subject: string;
  action: string;
  object: string;
  aliases?: string;
  files?: string;
  isBase?: boolean;
}

export interface EventResult {
  rowid: number;
  project: string;
  sessionId: string;
  date: string;
  subject: string;
  action: string;
  object: string;
  aliases: string;
  files: string;
  isBase: boolean;
  createdAt: string;
  rank?: number;
  score?: number;
}

// ---------------------------------------------------------------------------
// Decisions (ADRs)
// ---------------------------------------------------------------------------

export interface DecisionRecord {
  project: string;
  title: string;
  status?: string;
  context: string;
  decision: string;
  alternatives?: Array<{ name: string; proscons: string }>;
  consequences?: string;
  categories?: string[];
  impacts?: string[];
}

export interface DecisionRow {
  id: string;
  project: string;
  adr_number: number;
  title: string;
  status: string;
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
  categories: string;
  impacts: string;
  created_at: string;
}

export interface DecisionSummary {
  id: string;
  adrNumber: number;
  title: string;
  status: string;
  categories: string[];
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export interface FeatureRecord {
  project: string;
  slug: string;
  title: string;
  status?: string;
  summary?: string;
  categories?: string[];
  keyFiles?: Array<{ path: string; role: string }>;
  limitations?: string[];
}

export interface FeatureRow {
  slug: string;
  project: string;
  title: string;
  status: string;
  summary: string;
  categories: string;
  key_files: string;
  limitations: string;
  created_at: string;
}

export interface FeatureSummary {
  slug: string;
  title: string;
  status: string;
  categories: string[];
}

// ---------------------------------------------------------------------------
// Search & Retrieval
// ---------------------------------------------------------------------------

export interface ExpandedQuery {
  terms: string[];
  timeframe?: TimeRange;
  original: string;
}

export interface TimeRange {
  since?: string;
  until?: string;
}

export type SearchTarget = "sessions" | "events" | "all";

export interface RankedResult {
  id: string;
  type: "session" | "event";
  score: number;
  sources: Array<"keyword" | "vector">;
  summary?: string;
  date?: string;
  subject?: string;
  action?: string;
  object?: string;
}

export interface VectorResult {
  id: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Embeddings (binary format)
// ---------------------------------------------------------------------------

export interface BinEmbeddingIndex {
  version: number;
  count: number;
  dimension: number;
  entries: Map<string, number>;
  hashes: Map<string, Uint8Array>;
  vectors: Float32Array;
}

// ---------------------------------------------------------------------------
// Context Loading
// ---------------------------------------------------------------------------

export type LoadContextTier = "minimal" | "default" | "focus" | "full" | "task";

export interface LoadContextOptions {
  project: string;
  tier?: LoadContextTier;
  task?: string;
}
