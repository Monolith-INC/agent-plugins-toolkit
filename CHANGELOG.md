# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - M4 Vendor Payload Compiler & Transactional Installer

### Added

- Deterministic `@agent-plugins/compiler` contracts for canonical plugins, vendor bundles, file digests, install plans, installed records, journals, and result envelopes
- Claude, Cursor, and Codex adapter packages with schema evidence, shared conformance coverage, and verified adapter-owned `hello-world@1.0.0` payloads
- `@agent-plugins/installer` transactional install engine with target locks, same-filesystem staging, durable journals, exact rollback, installed-record verification, stale owned-file cleanup, and unchanged reinstall detection
- `agent-plugin install <plugin> --vendor <claude|cursor|codex> --target <directory>` as the single shipped-payload install command
- CI and local release evidence for payload drift, bundle conformance, installer rollback, permission failure, lifecycle coverage for all three vendors, documentation command verification, package contents, and provenance placement
- M4 documentation covering canonical authoring, adapter conformance, installation, rollback/recovery, compatibility policy, payload digests, and release notes

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
