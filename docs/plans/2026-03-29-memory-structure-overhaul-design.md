# obsidian-memory v2 — Architecture Rework Design

**Date:** 2026-03-29
**Status:** Proposed
**Branch:** emdash/memory-structure-overhaul-1wf

## Motivation

obsidian-memory v1 uses Obsidian desktop app + CLI as its persistence layer, with JSON/JSONL files bolted on for embeddings and events. Research on long-term LLM memory (Chronos paper, neuroscience episodic memory models) reveals three structural problems:

1. **No temporal index without LLM** — Events only exist if Gemini extracts them. No API key = no temporal index at all. The Chronos ablation showed removing the temporal index costs −34.5 accuracy points. It can't be optional.

2. **Obsidian as runtime dependency** — Every read/write shells out to `obsidian vault=X`. Requires GUI app running. No headless agents, no CI, no server-side. `resolveVaultPath` duplicated 4 times across commands.

3. **Storage fragmentation** — Three separate stores (Obsidian notes, `index.json` for embeddings, `events.jsonl`) with no cross-indexing. The dual-index architecture (temporal + semantic) the research prescribes requires unified query capability.

## Architecture

### Persistence Layer: Two Files

**`memory.db` (SQLite)** — Structured data + keyword search (FTS5 with BM25).

- Sessions (raw episodic records)
- Events (temporal index with FTS5)
- Decisions (ADR structured data)
- Features (indexed metadata)
- Project metadata + config

**`embeddings.bin` (flat binary)** — Semantic index.

- Contiguous Float32Array block, memory-map friendly
- Path lookup table as header
- Brute-force cosine similarity in JS (correct at <10K docs)
- Gracefully absent when no API key

Both live in `.obsidian-memory/` in the project root (or configurable path). No Obsidian dependency. Fully portable.

**Why not SQLite for vectors:** SQLite has no native vector similarity. Storing embeddings as BLOBs means loading every row and computing cosine sim in JS — at which point SQLite is a worse blob store than a flat binary file. The research (Chronos) uses FAISS in-process for the same reason. At <10K documents, brute-force on a flat Float32Array is functionally equivalent to FAISS without the IVF training overhead.

**Why SQLite for everything else:** FTS5 gives ranked keyword search (BM25) for free — replacing both Obsidian CLI search and the current linear-scan `searchEvents`. Date-range queries, relational joins (event → session), and structured metadata filtering are natural SQL. Eliminates the Obsidian desktop dependency entirely.

### Obsidian as Optional Export

Obsidian becomes a sync target, not the storage engine. A `sync` command exports SQLite state to markdown notes for browsing in Obsidian's graph view. The vault is a read-only rendering of the database, not the source of truth.

### SQLite Schema

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  agent       TEXT NOT NULL,
  date        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  content     TEXT NOT NULL,
  files       TEXT DEFAULT '',
  decisions   TEXT DEFAULT '',
  blockers    TEXT DEFAULT '',
  next_steps  TEXT DEFAULT '',
  archived    INTEGER DEFAULT 0,
  enriched    INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_project_date ON sessions(project, date DESC);

CREATE TABLE events (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  project     TEXT NOT NULL,
  session_id  TEXT REFERENCES sessions(id),
  date        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  action      TEXT NOT NULL,
  object      TEXT NOT NULL,
  aliases     TEXT DEFAULT '',
  files       TEXT DEFAULT '',
  is_base     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_project_date ON events(project, date DESC);

CREATE VIRTUAL TABLE events_fts USING fts5(
  subject, action, object, aliases, files,
  content='events',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- FTS5 sync triggers (insert/delete/update)
-- See full spec for trigger definitions

CREATE TABLE decisions (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  adr_number  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT DEFAULT 'accepted',
  context     TEXT NOT NULL,
  decision    TEXT NOT NULL,
  alternatives TEXT DEFAULT '',
  consequences TEXT DEFAULT '',
  categories  TEXT DEFAULT '',
  impacts     TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE features (
  slug        TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT DEFAULT 'in-progress',
  summary     TEXT DEFAULT '',
  categories  TEXT DEFAULT '',
  key_files   TEXT DEFAULT '',
  limitations TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Embeddings Binary Format

```
Header (12 bytes):
  version:    u32    (1)
  count:      u32    (number of entries)
  dimension:  u32    (768)

Path index (variable):
  For each entry:
    path_len:     u16
    path_bytes:   u8[path_len]    (UTF-8)
    content_hash: u8[16]          (truncated SHA-256)

Vector block (count × dimension × 4 bytes):
  Contiguous Float32Array
  Entry i starts at offset (i * dimension * 4)
```

## 3-LLM Cascade

### Stage 1: Event Extractor (Write Path, Async)

Two layers:
- **Layer 0** — Deterministic base event (sync, no LLM). Every `save-session` writes a base event using CLI-provided data. Temporal index is never empty.
- **Layer 1** — LLM enrichment (async, best-effort). Background process calls Gemini Flash to extract 1-5 fine-grained SVO events. Atomic swap via transaction. 10s timeout to prevent hanging.

### Stage 2: Query Expander (Query Path, Shared Utility)

Module `src/lib/query-expander.ts`. Expands raw queries into richer search terms. Without API key, passthrough (split on whitespace). All retrieval commands use it.

### Stage 3: Reasoning Agent (External)

The calling agent (Claude Code, Cursor, etc.) is Stage 3. CLI commands are the tool interface.

## Retrieval Pipeline

Hybrid search: FTS5 (BM25) + vector (cosine similarity) → Reciprocal Rank Fusion (k=60).

## Graceful Degradation

Every command works without an API key. LLM makes results richer, not possible.

| Capability | With GEMINI_API_KEY | Without |
|---|---|---|
| `save-session` | Full SVO extraction + aliases + embedding | Base event only |
| `search` | Query expansion + FTS5 + vector + RRF | FTS5 keyword only |
| `query` | Query expansion + FTS5 events + vector sessions | FTS5 events only |
| `timeline` | Full enriched events | Base events (one per session) |
| `load-context --task` | Guided retrieval + hybrid search | Falls back to default tier |

## File Structure

```
project-root/
├── .obsidian-memory/
│   ├── config.json
│   ├── memory.db
│   ├── embeddings.bin       (absent without API key)
│   └── enrichment.lock
├── AGENTS.md
├── CLAUDE.md
└── ...
```

## Implementation Order

### Wave 1: Core Store
1. `src/lib/store.ts` — MemoryStore class with SQLite schema
2. `src/lib/embeddings-bin.ts` — Binary embedding file format
3. `src/lib/query-expander.ts` — Shared expandQuery utility
4. `src/lib/retrieval.ts` — hybridSearch function (FTS5 + vector + RRF)

### Wave 2: Command Migration
5-14. Migrate all commands from ObsidianCLI to MemoryStore

### Wave 3: Export + Migration
15-17. sync, migrate commands + remove old dependencies

### Wave 4: Cleanup
18-21. Update docs, tests, README
