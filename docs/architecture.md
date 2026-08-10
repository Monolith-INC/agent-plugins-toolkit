# Agent Plugins Toolkit Architecture

The toolkit is a pnpm workspace with explicit package boundaries:

- `packages/core` — portable data types, diagnostics, and inspection primitives (`loadPluginRoot`, `inspectPlugin`, `inspectManifest`)
- `packages/compiler` — canonical plugin normalization, deterministic bundle contracts, byte/mode hashing, and shipped payload drift verification
- `packages/adapter-claude` — Claude Code payload rendering, validation, install planning, schema evidence, and shipped payloads
- `packages/adapter-cursor` — Cursor payload rendering, validation, install planning, schema evidence, and shipped payloads
- `packages/adapter-codex` — Codex payload rendering, validation, install planning, schema evidence, and shipped payloads
- `packages/installer` — lock, stage, journal, commit, verify, cleanup, rollback, and installed-record handling for target directories
- `packages/cli` — command-line entrypoints (`agent-plugin validate|inspect|install|create|add skill`)
- `packages/testing` — shared fixtures helpers for package tests

## Portable inspection model

`loadPluginRoot(path)` reads a plugin directory and returns a `PluginInspection`:

- `manifest` — typed portable fields when valid
- `skills` — discovered immediate Skills (when any)
- `mcpServers` — discriminated MCP transport entries (when any)
- `diagnostics` — structured, component-scoped findings

Partial results are preserved when some components fail: diagnostics accumulate while valid siblings remain available.

## Non-goals for core

Client-specific runtime code (hooks execution, MCP process supervision, marketplace packaging) stays outside `packages/core`. The portable core loads and validates; hosts decide how to run.

## Vendor payload installation model

M4 adds a one-way release path:

```text
portable plugin source
        |
        v
canonical compiler model
        |
        v
adapter-owned shipped payload directory
        |
        v
agent-plugin install
        |
        v
transactional target mutation
```

Vendor payload provenance is stored in the toolkit `bundle.json` envelope for each shipped payload. Closed vendor files such as `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and `.codex-plugin/plugin.json` contain only fields accepted by their owning adapter schema.

The installer receives a verified bundle and an adapter. It never compiles portable source, fetches remote artifacts, executes plugin content, or bypasses the shared transaction engine.
