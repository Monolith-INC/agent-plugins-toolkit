# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-09

Initial M1 portable-core release of the Agent Plugins Toolkit.

### Added

- Monorepo packages `@agent-plugins/core`, `@agent-plugins/cli`, and `@agent-plugins/testing`
- `loadPluginRoot` / `inspectPlugin` / `inspectManifest` with structured diagnostics
- v1 portable manifest validation: required fields, npm-style names, `schemaVersion`, closed-field rejection, opaque `extensions`
- Immediate-child Skill discovery with deterministic ordering and missing-`SKILL.md` diagnostics
- MCP `mcp.json` parsing for `stdio`, `streamable-http`, `sse`, and `config-path` transports
- Explicit `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` placeholder reporting on inspected MCP servers
- CLI commands `agent-plugin validate` and `agent-plugin inspect` (path argument or cwd default)
- Reference plugin `plugins/hello-world` and validate/inspect fixtures under `fixtures/`

### Safety

- Validation and inspection stay filesystem/JSON-only: no plugin script execution, no MCP process spawn, no remote connections
