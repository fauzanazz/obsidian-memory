# Progress — FAU-60: Task-Aware Context Loading + Temporal Query Commands

## Status: Complete

All 11 features implemented and tested. TypeScript type-check passes. 52 new tests across 5 files, all passing.

## What was accomplished

### New library files (dependencies that didn't exist from waves FAU-57/58/59)
- `src/lib/event-extractor.ts` — JSONL event file reader with date filtering, keyword search, markdown formatting, and append capability
- `src/lib/embeddings.ts` — Vector search via Gemini embedding API with cosine similarity, plus reciprocal rank fusion for combining keyword + vector results
- `src/lib/config.ts` — Added `resolveVaultPath()` utility shared by all new commands

### New commands
- `src/commands/timeline.ts` — `obsidian-memory timeline` with `--last`, `--since`, `--until`, `--project`, `--limit` flags
- `src/commands/query.ts` — `obsidian-memory query <text>` with `--since`, `--until`, `--limit` flags; searches events + retrieves linked sessions via hybrid search

### Modified files
- `src/commands/load-context.ts` — Added `"task"` tier with LLM retrieval guidance → hybrid search → event/session assembly. Falls back to default tier without GEMINI_API_KEY
- `src/index.ts` — Added `--task <description>` flag to load-context, wired timeline and query commands

### Tests
- `tests/unit/event-extractor.test.ts` — 17 tests
- `tests/unit/embeddings.test.ts` — 5 tests
- `tests/commands/timeline.test.ts` — 9 tests
- `tests/commands/query.test.ts` — 5 tests
- `tests/commands/load-context.test.ts` — 2 new tests (task tier fallback)

## Decisions made
- Created `event-extractor.ts` and `embeddings.ts` from scratch since they were assumed to exist from prior waves (FAU-57/58/59) but weren't present on this branch
- Added `resolveVaultPath` to `config.ts` as a shared utility rather than duplicating it in each command file
- Used `LoadContextDefaults` type alias to avoid type conflicts after adding `taskDescription` to `LoadContextOptions`

## What's left
- Nothing — all design document requirements are implemented and tested

## Pre-existing test failures (not introduced by this work)
- `tests/unit/llm.test.ts` — 4 failures (callLLMJson mock issues)
- `tests/commands/maintain.test.ts` — 3 failures (enrichment.features undefined)
