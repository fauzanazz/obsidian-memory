---
type: project
project: todo-app
created: 2026-03-21
updated: 2026-03-22
tags:
  - project/todo-app
---

# todo-app

## Tech Stack
- **Runtime:** Bun
- **Framework:** Hono
- **Database:** SQLite via bun:sqlite
- **Language:** TypeScript (strict mode)

## Architecture
- Single-file API server (`src/index.ts`)
- SQLite database with migrations in `src/db.ts`
- REST API with JSON responses

## Conventions
- Use Hono's built-in context helpers (`c.json()`, `c.req.json()`)
- All responses are JSON
- Error responses use `{ error: "message" }` format
- IDs are auto-incrementing integers

## Notes
- Started as an in-memory store, migrating to SQLite
- No auth yet — planned for next phase
