---
type: decisions
project: todo-app
created: 2026-03-21
updated: 2026-03-22
tags:
  - project/todo-app
  - decisions
---

# Decisions — todo-app

<!-- Architecture Decision Records (ADR) style log -->
<!-- Newest entries at the top -->

### 2026-03-22 — Use zod for input validation
- **Context:** Need to validate POST/PATCH request bodies
- **Decision:** Use zod schemas, return 400 with structured errors
- **Status:** Accepted

### 2026-03-21 — SQLite over PostgreSQL
- **Context:** Choosing a database for a small todo API
- **Decision:** Use SQLite via `bun:sqlite` for zero-config local development
- **Status:** Accepted

### 2026-03-21 — Hono over Express
- **Context:** Picking a web framework for the Bun runtime
- **Decision:** Use Hono — native Bun support, fast, TypeScript-first
- **Status:** Accepted
