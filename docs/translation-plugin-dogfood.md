# Translation Plugin Dogfood

The `plugins/translation` package is the M3 dogfood consumer for Agent Plugins Toolkit portable authoring.

## What it exercises

| Capability | Where |
| --- | --- |
| Multi-Skill discovery | `skills/translate`, `skills/review`, `skills/terminology` |
| Optional MCP declaration | `mcp.json` terminology stdio service with `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` |
| Opaque extensions | `extensions["com.acme.translation"]` (see `EXTENSIONS.md`) |
| Diagnostic recovery | fixtures under `fixtures/invalid/translation-*` |
| Non-execution | CLI/core tests inspect metadata only |

## How to inspect

```bash
pnpm --filter @agent-plugins/cli build
node packages/cli/dist/index.js validate plugins/translation
node packages/cli/dist/index.js inspect plugins/translation
```

## Intentional stops (non-goals)

- No vendor payload compilation (Claude/Cursor/Codex adapters) — that is M4.
- No `agent-plugin install` / transactional installation.
- No runtime MCP server process, glossary service, or network calls during validate/inspect.
- No host-specific hooks, rules, or wire/activation steps.

## Follow-ups discovered while dogfooding

- Wire AGE-24 authoring CLI (`create` / `add skill`) into contributor docs once merged, so the plugin can be reproduced from scaffolding commands rather than hand-authored files.
- After AGE-26 merges, add an explicit escaping-symlink fixture next to the translation plugin samples.
- Keep `com.acme.translation` documentation synchronized if extension fields grow beyond opaque metadata.
