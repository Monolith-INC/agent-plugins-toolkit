# Agent Plugins Toolkit Architecture

The toolkit is a pnpm workspace with three package boundaries:

- `packages/core` — portable data types, diagnostics, and inspection primitives (`loadPluginRoot`, `inspectPlugin`, `inspectManifest`)
- `packages/cli` — command-line entrypoints (`agent-plugin validate|inspect`) that depend on `packages/core`
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
