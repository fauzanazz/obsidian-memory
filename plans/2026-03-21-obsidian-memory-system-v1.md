# Obsidian-Based Memory System for Multi-Agent AI Compatibility

## Objective

Build a universal memory system that uses an Obsidian vault as the persistent, structured knowledge store for AI coding agents. The system leverages the **official Obsidian CLI (v1.12+)** and an **MCP server** to provide read/write access to a shared memory vault, enabling cross-agent context continuity across **Claude Code, Cursor, Antigravity, OpenCode, and ForgeCode**.

The core insight: all five target agents support `AGENTS.md` as a universal instruction standard, and all support MCP (Model Context Protocol) for tool integration. By combining a standardized AGENTS.md with an Obsidian MCP server, every agent gains structured, searchable, persistent memory without proprietary lock-in.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agents (Consumers)                     │
│                                                             │
│  Claude Code  │  Cursor  │  Antigravity  │ OpenCode │ Forge │
│  CLAUDE.md    │ .cursor/ │  GEMINI.md    │ AGENTS.md│AGENTS │
│  AGENTS.md    │ rules/   │  AGENTS.md    │          │ .md   │
└──────┬────────┴────┬─────┴──────┬───────┴────┬─────┴───┬───┘
       │             │            │            │         │
       ▼             ▼            ▼            ▼         ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP Server (obsidian-memory-mcp)               │
│                                                             │
│  Tools: memory_read, memory_write, memory_search,           │
│         memory_list, memory_append, memory_tag,             │
│         context_load, session_save                          │
│                                                             │
│  Transport: stdio (local) / HTTP (networked)                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Obsidian CLI (v1.12+) Bridge                   │
│                                                             │
│  obsidian read | create | append | search | properties      │
│  obsidian tags | links | backlinks | daily                  │
│                                                             │
│  Requirement: Obsidian app running (CLI = remote control)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               Obsidian Vault (Knowledge Store)              │
│                                                             │
│  Memory/                                                    │
│  ├── Agents/           # Per-agent session logs             │
│  ├── Projects/         # Per-project context & decisions    │
│  ├── Conventions/      # Shared coding standards            │
│  ├── Decisions/        # Architecture decision records      │
│  ├── Sessions/         # Timestamped session transcripts    │
│  ├── Journal/          # Append-only insights log           │
│  └── Index.md          # Master index, auto-maintained      │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Compatibility Matrix

| Agent | Instruction File | MCP Support | Memory Convention | AGENTS.md |
|-------|-----------------|-------------|-------------------|-----------|
| **Claude Code** | `CLAUDE.md` + `.claude/rules/` | Yes (stdio/SSE) | `~/.claude/projects/*/memory/MEMORY.md` | Yes (via @import) |
| **Cursor** | `.cursor/rules/*.mdc` | Yes (stdio) | `.cursor/memory/` (Memory Bank) | Yes (auto-detected) |
| **Antigravity** | `GEMINI.md` + `AGENTS.md` | Yes (stdio) | Knowledge Items | Yes (v1.20.3+) |
| **OpenCode** | `AGENTS.md` + `opencode.json` | Yes (stdio/plugins) | `.opencode/memory/` or plugins | Yes (native) |
| **ForgeCode** | `AGENTS.md` + `forge.yaml` | Yes (stdio) | `custom_rules` in forge.yaml | Yes (native, equiv to CLAUDE.md) |

---

## Implementation Plan

### Phase 1: Project Foundation & Vault Structure

- [ ] **1.1 Initialize the project repository**
  - Initialize git, create `package.json` with TypeScript, set up `tsconfig.json`
  - Technology: TypeScript + Node.js (universally compatible with all agent MCP implementations)
  - Rationale: TypeScript is the most common language for MCP servers and all target agents support Node.js-based MCP

- [ ] **1.2 Define the Obsidian vault directory structure for memory**
  - Design a standardized vault folder hierarchy under a `Memory/` root folder
  - Structure:
    ```
    Memory/
    ├── Index.md                    # Auto-maintained master index
    ├── Agents/
    │   ├── claude-code.md          # Agent-specific preferences & patterns
    │   ├── cursor.md
    │   ├── antigravity.md
    │   ├── opencode.md
    │   └── forgecode.md
    ├── Projects/
    │   └── {project-name}/
    │       ├── context.md          # Tech stack, architecture, conventions
    │       ├── decisions.md        # ADR-style decision log
    │       └── progress.md         # Current state, todos, blockers
    ├── Conventions/
    │   ├── coding-standards.md     # Shared code style rules
    │   ├── testing-patterns.md     # Testing conventions
    │   └── git-workflow.md         # Git/commit conventions
    ├── Sessions/
    │   └── {YYYY-MM-DD}-{agent}-{hash}.md  # Session transcripts
    ├── Journal/
    │   └── {YYYY-MM}.md            # Monthly append-only insight log
    └── Templates/
        ├── session.md              # Session note template
        ├── project.md              # Project context template
        └── decision.md             # Decision record template
    ```
  - Rationale: This structure leverages Obsidian's strengths (wikilinks, tags, graph view, search) while keeping memory organized by scope

- [ ] **1.3 Create Obsidian vault templates with YAML frontmatter**
  - Each template should include standardized frontmatter properties: `type`, `agent`, `project`, `created`, `updated`, `tags`
  - Rationale: Frontmatter enables property-based search via Obsidian CLI (`obsidian search query="type::decision"`)

- [ ] **1.4 Design the memory note format specification**
  - Define a markdown schema that all agents can read/write consistently
  - Include sections: metadata (frontmatter), summary, details, related links (wikilinks), tags
  - Rationale: A consistent format prevents agents from creating incompatible memory structures

### Phase 2: Obsidian CLI Integration Layer

- [ ] **2.1 Build the Obsidian CLI wrapper module**
  - Create a TypeScript module that wraps Obsidian CLI commands into async functions
  - Key functions: `readNote()`, `createNote()`, `appendNote()`, `searchVault()`, `setProperty()`, `getTags()`, `getBacklinks()`
  - Handle vault targeting (`vault="VaultName"` parameter) for multi-vault setups
  - Parse CLI output formats (JSON, text, paths) into structured TypeScript objects
  - Rationale: Abstraction layer decouples MCP server from CLI specifics, enabling future backend swaps

- [ ] **2.2 Implement error handling and CLI availability detection**
  - Detect if Obsidian is running (CLI requires running app)
  - Implement graceful fallback: if CLI unavailable, fall back to direct filesystem access for read-only operations
  - Validate Obsidian version >= 1.12.4 at startup
  - Rationale: Robustness is critical since the CLI is a "remote control" for a running Obsidian instance

- [ ] **2.3 Implement vault health checks and initialization**
  - Check if the `Memory/` folder structure exists in the target vault
  - Auto-create missing directories and template files on first run
  - Validate vault path configuration
  - Rationale: Zero-friction setup experience for new users

### Phase 3: MCP Server Implementation

- [ ] **3.1 Scaffold the MCP server using `@modelcontextprotocol/sdk`**
  - Set up the MCP server with stdio transport (primary) and optional HTTP/SSE transport
  - Register server info, capabilities, and tool definitions
  - Rationale: stdio is universally supported by all five target agents; HTTP enables future remote access

- [ ] **3.2 Implement core memory tools**
  - **`memory_read`**: Read a specific memory note by name or path. Supports wikilink-style resolution.
    - Parameters: `name` (string), `path` (optional string), `project` (optional string)
  - **`memory_write`**: Create or update a memory note with structured content.
    - Parameters: `name`, `content`, `type` (project|convention|decision|agent|session), `project` (optional), `tags` (optional array)
  - **`memory_search`**: Search memory vault by content, tags, or properties.
    - Parameters: `query` (string), `tags` (optional array), `type` (optional string), `path` (optional string), `limit` (optional number)
  - **`memory_list`**: List memory notes, optionally filtered by folder, type, or project.
    - Parameters: `folder` (optional), `type` (optional), `project` (optional)
  - **`memory_append`**: Append content to an existing memory note (ideal for journals and session logs).
    - Parameters: `name`, `content`, `section` (optional, to append under a specific heading)
  - **`memory_tag`**: Add, remove, or list tags on a memory note.
    - Parameters: `name`, `action` (add|remove|list), `tags` (array)
  - Rationale: These six tools cover the CRUD + search pattern that all memory workflows require

- [ ] **3.3 Implement context-loading tools**
  - **`context_load`**: Load all relevant context for a given project — reads project context.md, conventions, and recent decisions. Returns a consolidated markdown block.
    - Parameters: `project` (string), `include_conventions` (boolean, default true), `include_recent_decisions` (number, default 5)
  - **`session_save`**: Save a session summary to the Sessions folder with proper frontmatter and cross-links.
    - Parameters: `agent` (string), `project` (string), `summary` (string), `decisions` (optional array), `todos` (optional array)
  - Rationale: These higher-level tools reduce token usage by providing pre-assembled context rather than requiring multiple tool calls

- [ ] **3.4 Implement MCP resources for passive context**
  - Expose vault notes as MCP resources that agents can browse and read
  - Resource URI scheme: `obsidian://memory/{path}`
  - List resources dynamically from the Memory folder
  - Rationale: Resources allow agents to discover available memory without explicit tool calls

- [ ] **3.5 Add search enhancements**
  - Implement tag-based filtering using Obsidian CLI `tags` command
  - Implement backlink traversal using `backlinks` command for related note discovery
  - Support property-based search for typed queries (e.g., all decisions for project X)
  - Rationale: Obsidian's linking system is a key differentiator — leveraging it makes memory retrieval more intelligent than flat file search

### Phase 4: Universal Agent Configuration (AGENTS.md Generator)

- [ ] **4.1 Create the shared AGENTS.md template**
  - Write a universal `AGENTS.md` that all agents read, containing:
    - Memory system usage instructions (how to use the MCP tools)
    - Memory protocol (when to save, what to save, naming conventions)
    - Loading protocol (what to load at session start)
    - Reference to the MCP server configuration
  - Rationale: AGENTS.md is the one file all five agents read natively — it's the universal entry point

- [ ] **4.2 Build agent-specific configuration generators**
  - Generate per-agent configuration files from a single source of truth:
    - **Claude Code**: `CLAUDE.md` with `@AGENTS.md` import + `.claude/rules/memory-protocol.md` + MCP config in `~/.claude/mcp.json`
    - **Cursor**: `.cursor/rules/memory.mdc` with `alwaysApply: true` + MCP server registration
    - **Antigravity**: `GEMINI.md` (Antigravity-specific overrides) + `AGENTS.md` (shared) + MCP configuration
    - **OpenCode**: `AGENTS.md` (native) + `opencode.json` with plugin/MCP config + optional `instructions` field referencing memory docs
    - **ForgeCode**: `AGENTS.md` (native, equivalent to CLAUDE.md) + `forge.yaml` with MCP integration + `custom_rules` section
  - Rationale: Single source of truth prevents configuration drift across agents

- [ ] **4.3 Implement a CLI setup command (`obsidian-memory init`)**
  - Interactive setup wizard that:
    1. Detects installed agents (checks for `.claude/`, `.cursor/`, `GEMINI.md`, `.opencode/`, `forge.yaml`)
    2. Prompts for Obsidian vault path
    3. Creates vault Memory folder structure
    4. Generates agent-specific configuration files
    5. Registers the MCP server with each detected agent
  - Rationale: One-command setup reduces adoption friction to near zero

### Phase 5: Memory Protocol & Cross-Agent Sync

- [ ] **5.1 Define the memory lifecycle protocol**
  - Document when and how agents should interact with memory:
    - **Session Start**: Load project context via `context_load`, check recent journal entries
    - **During Work**: Save important decisions via `memory_write` with type `decision`
    - **Before Context Compaction**: Save session summary via `session_save`
    - **Session End**: Append key insights to the monthly journal via `memory_append`
  - Encode this protocol in `AGENTS.md` as imperative instructions
  - Rationale: Without explicit protocol, agents won't consistently save/load memory

- [ ] **5.2 Implement cross-agent context handoff format**
  - Design a `handoff.md` template that captures:
    - Current state of work (what was done, what's pending)
    - Active files and their state
    - Key decisions made with rationale
    - Blockers or questions
  - Agents write handoff notes when a session ends; the next agent (any tool) reads them
  - Rationale: The primary value proposition — switch between Claude Code, Cursor, etc. without losing context

- [ ] **5.3 Build automatic session logging**
  - The MCP server automatically logs each tool invocation to a session file
  - Session files are stored in `Memory/Sessions/` with agent name and timestamp
  - Include a configurable privacy level (full, summary-only, disabled)
  - Rationale: Creates an audit trail and enables post-hoc analysis of agent behavior

- [ ] **5.4 Implement memory deduplication and consolidation**
  - Periodic consolidation: merge overlapping session notes into project context
  - Detect and merge duplicate information across agent-specific notes
  - Keep memory lean to avoid context window bloat
  - Rationale: Without consolidation, memory grows unboundedly and becomes noisy

### Phase 6: Advanced Features

- [ ] **6.1 Implement semantic search via embeddings (optional)**
  - Use a local embedding model (e.g., bundled multilingual model) to create vector embeddings of memory notes
  - Store embeddings in a SQLite file alongside the vault
  - Enable semantic queries like "what decisions did we make about authentication?"
  - Rationale: BM25/keyword search misses semantically related notes using different vocabulary

- [ ] **6.2 Build graph-aware memory retrieval**
  - Leverage Obsidian's `backlinks`, `links`, and `orphans` CLI commands
  - When loading context, automatically include linked notes up to a configurable depth
  - Rationale: Obsidian's graph is its killer feature — memory retrieval should exploit link structure

- [ ] **6.3 Implement memory expiration and archival**
  - Mark memory notes with `ttl` (time-to-live) frontmatter property
  - Auto-archive expired notes to `Memory/Archive/`
  - Keep the active memory set small and relevant
  - Rationale: Prevents context pollution from stale information

- [ ] **6.4 Add daily note integration**
  - Integrate with Obsidian's daily notes feature
  - Auto-append AI session summaries to the daily note
  - Use `obsidian daily:append` for seamless integration
  - Rationale: Many Obsidian users already have a daily note workflow — integrate rather than replace

### Phase 7: Testing, Documentation & Distribution

- [ ] **7.1 Write comprehensive tests**
  - Unit tests for the CLI wrapper module (mock CLI output parsing)
  - Integration tests for MCP server tools (use a test vault)
  - End-to-end tests for the setup wizard
  - Cross-agent compatibility tests (verify generated configs work with each agent)
  - Rationale: Memory corruption or data loss would be catastrophic — testing is non-negotiable

- [ ] **7.2 Create user documentation**
  - README with quick-start guide
  - Per-agent setup guides (with screenshots/examples for each tool)
  - Memory protocol reference
  - Troubleshooting guide (common issues: Obsidian not running, vault path wrong, etc.)
  - Rationale: Multi-agent support means a diverse user base with different setups

- [ ] **7.3 Package and distribute**
  - Publish as an npm package (`obsidian-memory`)
  - Provide a global CLI (`npx obsidian-memory init`)
  - Submit to LobeHub Skills Marketplace for discoverability
  - Create MCP server configuration snippets for each agent's documentation format
  - Rationale: npm is the natural distribution channel for TypeScript MCP servers

- [ ] **7.4 Create example workflows**
  - "Start a new project with memory" workflow
  - "Switch from Cursor to Claude Code mid-project" workflow
  - "Team shared memory" workflow (multiple developers, one vault via Obsidian Sync)
  - Rationale: Concrete examples are more valuable than abstract documentation

---

## Verification Criteria

1. **Universal Agent Support**: The MCP server can be registered and used by all five target agents (Claude Code, Cursor, Antigravity, OpenCode, ForgeCode) without modification
2. **Cross-Agent Continuity**: A session started in Claude Code can be meaningfully continued in Cursor (or any other agent) by loading the saved context
3. **Zero Manual Memory Management**: The memory protocol in AGENTS.md causes agents to automatically save and load context without user intervention
4. **Obsidian-Native**: All memory is stored as standard Obsidian markdown with wikilinks, tags, and frontmatter — fully browsable and editable in the Obsidian app
5. **Setup Under 5 Minutes**: Running `npx obsidian-memory init` configures everything needed for at least one agent
6. **Vault Health**: Memory structure stays organized — no orphan notes, no unbounded growth, no duplicate information
7. **Graceful Degradation**: If Obsidian is not running, the system provides read-only access via filesystem fallback

---

## Potential Risks and Mitigations

1. **Obsidian CLI requires a running Obsidian instance**
   - Mitigation: Implement filesystem-based fallback for read operations. For write operations, queue changes and apply when Obsidian becomes available, or write directly to `.md` files with a warning about potential sync issues
   - Alternative: Consider supporting direct filesystem mode as a first-class option for headless/server environments

2. **Context window bloat from loading too much memory**
   - Mitigation: Implement the `context_load` tool with configurable depth and size limits. Use frontmatter properties to prioritize recent, relevant memory. Cap loaded context at a configurable token limit (default ~2000 tokens)

3. **Memory format inconsistency across agents**
   - Mitigation: All write operations go through the MCP server which enforces the format specification. Include format validation on read to detect and repair malformed notes

4. **Agent-specific configuration drift**
   - Mitigation: Single-source generation from a config template. Include a `obsidian-memory sync-config` command to regenerate agent configs from the latest template

5. **Obsidian CLI API instability (new feature, still evolving)**
   - Mitigation: Wrap all CLI interactions in a versioned adapter layer. Pin minimum Obsidian version. Include version-checking at startup with clear error messages

6. **Security — vault contents exposed via MCP**
   - Mitigation: MCP server only exposes the `Memory/` subdirectory, not the entire vault. Path validation prevents directory traversal. Optional read-only mode for sensitive environments

7. **Multi-user conflicts (shared vaults via Obsidian Sync)**
   - Mitigation: Use append-only patterns for session logs and journals. Implement conflict-free note naming with timestamps and agent identifiers. Leverage Obsidian Sync's built-in conflict resolution

---

## Alternative Approaches

1. **Direct filesystem access instead of Obsidian CLI**
   - Pros: No dependency on running Obsidian, simpler architecture, works in headless environments
   - Cons: Loses link integrity on moves, no access to Obsidian features (templates, plugins, graph), bypasses Obsidian's file monitoring
   - Recommendation: Support as a fallback mode, not the primary approach

2. **Obsidian REST API plugin instead of CLI**
   - Pros: Works over HTTP, more traditional API approach, supported by existing MCP servers (e.g., `obsidian-api-mcp-server`)
   - Cons: Requires a community plugin to be installed, adds another dependency, REST API may have different capabilities than CLI
   - Recommendation: Consider as an alternative transport if CLI limitations surface

3. **Plain markdown files without Obsidian (just a folder of .md)**
   - Pros: Zero dependencies, works everywhere, simpler to implement
   - Cons: Loses Obsidian's graph view, tag management, template system, daily notes integration, and most importantly the GUI for human browsing/editing
   - Recommendation: Not recommended — Obsidian's value-add is precisely the human-accessible knowledge graph layer on top of markdown

4. **Vector database (Pinecone/ChromaDB) instead of Obsidian**
   - Pros: Better semantic search, handles large-scale memory efficiently
   - Cons: Not human-browsable, requires external service, adds complexity, not the project's goal
   - Recommendation: Can be added as a supplementary layer (Phase 6) alongside Obsidian, not as a replacement

5. **Per-agent memory files instead of shared vault**
   - Pros: Simpler, each agent manages its own memory independently
   - Cons: No cross-agent continuity (defeats the primary purpose), duplication, no unified view
   - Recommendation: The shared vault IS the core differentiator — this approach would negate the project's value

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript 5.x | Universal MCP server language, strong typing, npm ecosystem |
| Runtime | Node.js 18+ | Required by MCP SDK, available on all platforms |
| MCP SDK | `@modelcontextprotocol/sdk` | Official SDK, supported by all target agents |
| CLI Bridge | Obsidian CLI v1.12.4+ | Official, maintained by Obsidian team, 100+ commands |
| Build | tsup or esbuild | Fast bundling for npm distribution |
| Testing | Vitest | Modern, fast, TypeScript-native |
| CLI Framework | Commander.js | For the `obsidian-memory` setup CLI |
| Distribution | npm | Universal package manager, `npx` support |

---

## Key Design Decisions

1. **AGENTS.md as the universal instruction layer**: All five agents support it. Put shared memory protocol instructions here. Agent-specific files (CLAUDE.md, GEMINI.md, etc.) only contain imports/overrides.

2. **MCP as the integration protocol**: Rather than building agent-specific plugins for each tool, one MCP server serves all agents through the same interface. This is the correct architectural choice for 2026.

3. **Obsidian CLI over filesystem access**: Using the CLI ensures link integrity, proper frontmatter handling, and compatibility with Obsidian's internal state. The trade-off (Obsidian must be running) is acceptable for most developer workflows.

4. **Structured vault hierarchy**: A `Memory/` prefix keeps AI memory organized separately from the user's regular notes. Sub-folders by type (Projects, Decisions, Sessions) enable efficient querying and maintenance.

5. **Append-only patterns for shared state**: Session logs and journals use append-only writes to avoid conflicts in multi-agent and multi-user scenarios.
