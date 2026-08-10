# Conformance and Security Test Matrix

This matrix documents AGE-27 coverage for the portable toolkit. All cases run in a clean checkout without privileged setup, network access, or process execution of plugin content.

| Component | Valid path | Invalid / adversarial path | Package test entry |
| --- | --- | --- | --- |
| Manifest identity | `fixtures/valid/hello-world` | missing name/version, invalid name, unknown field, unsupported schema | `packages/core/test/inspection.test.mjs`, `packages/cli/test/m1-integration.test.mjs`, `packages/cli/test/security.test.mjs` |
| Extensions | opaque object preserved | non-object extensions (fixture or unit) | `inspection.test.mjs`, `security.test.mjs` |
| Skill discovery | immediate-child only | missing `SKILL.md`, nested skills ignored, hostile directory names | `inspection.test.mjs`, `security.test.mjs` |
| MCP parsing | stdio / http / sse / placeholders as data | missing command, malformed JSON | `inspection.test.mjs`, `security.test.mjs` |
| Diagnostics | stable codes + partial results | severity/code/path snapshot assertions | `security.test.mjs` |
| Filesystem containment | in-root links (when AGE-26 present) | escaping symlinks never imported as skills | `security.test.mjs`, `containment.test.mjs` (AGE-26) |
| Non-execution | inspect/validate metadata only | source scans forbid `child_process` / `fetch` / spawn | `security.test.mjs` (core + CLI) |
| CLI | validate/inspect exit codes | invalid fixtures → stderr diagnostics JSON | `m1-integration.test.mjs`, `security.test.mjs` |
| Vendor payload compiler | canonical source to finalized bundle | missing, extra, changed, and mode-drifted payload output | `packages/compiler/test/pipeline.test.mjs` |
| Adapters | Claude, Cursor, and Codex shared conformance | schema identity mismatch and invalid vendor paths | `packages/*/test/*.test.mjs`, `packages/testing/test/adapter-conformance.test.mjs` |
| Transactional installer | install, unchanged reinstall, upgrade, stale owned-file cleanup | collision, lock, symlink, permission, poisoned bundle, mutation faults, exact rollback | `packages/installer/test/installer.test.mjs`, `packages/cli/test/release-evidence.test.mjs` |
| Release documentation | install commands, paths, digests, package contents, provenance placement | unsupported installation models in docs | `packages/cli/test/release-evidence.test.mjs` |

## Security boundary

- Skill markdown and MCP `command` / `url` values are data.
- Tests must not start MCP servers, shells, or HTTP clients against fixture content.
- Adversarial fixtures stay local and disposable (`os.tmpdir()`).
