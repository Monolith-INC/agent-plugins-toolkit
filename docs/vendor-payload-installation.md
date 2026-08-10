# Vendor Payload Installation

M4 completes the vendor payload path for the `hello-world` reference plugin. The supported release shape is intentionally narrow:

```text
canonical source
  plugins/hello-world/plugin.json
  plugins/hello-world/skills/hello-world/SKILL.md
        |
        v
compiler contracts and deterministic bundle finalization
        |
        v
adapter-owned shipped payloads
  packages/adapter-claude/payloads/hello-world
  packages/adapter-cursor/payloads/hello-world
  packages/adapter-codex/payloads/hello-world
        |
        v
single CLI command
        |
        v
transactional installer
```

## Authoring Guide

Canonical plugin authors edit only the portable plugin source:

- `plugins/hello-world/plugin.json`
- `plugins/hello-world/skills/hello-world/SKILL.md`

Generated payload content is owned by the adapter packages. The compiler normalizes the portable source, computes the source digest, asks the selected adapter to render vendor files, and finalizes `bundle.json` with file bytes, modes, hashes, adapter identity, and payload digest.

Do not hand-edit files under `packages/adapter-*/payloads/hello-world/payload/`. Regenerate with the owning adapter script, then run payload verification:

```sh
pnpm payloads:build
pnpm payloads:verify
```

## Adapter Guide

Each adapter owns all vendor-specific names, paths, manifest fields, schema evidence, validation, and install planning. The shared compiler and installer never special-case vendor file shapes.

Adapter conformance checklist:

- Export a frozen `VendorAdapter` with exact `vendor`, `adapterVersion`, `vendorSchemaVersion`, `compile`, `validate`, and `planInstallation` members.
- Keep schema evidence in `packages/adapter-*/schema/evidence.json`.
- Ship verified payloads under `packages/adapter-*/payloads/<plugin>/`.
- Include `payloads` and `schema` in the package `files` list.
- Pass the shared adapter conformance suite plus the package-specific payload build and verify scripts.
- Keep provenance in `bundle.json`; do not add toolkit provenance fields to closed vendor manifests.

## Installation

Build first so the workspace CLI executes the current compiled output:

```sh
pnpm build
```

Install the reference payload with one of these commands:

```sh
pnpm --filter @agent-plugins/cli exec agent-plugin install plugins/hello-world --vendor claude --target <target-directory>
pnpm --filter @agent-plugins/cli exec agent-plugin install plugins/hello-world --vendor cursor --target <target-directory>
pnpm --filter @agent-plugins/cli exec agent-plugin install plugins/hello-world --vendor codex --target <target-directory>
```

Successful output is a stable JSON envelope:

```json
{
  "ok": true,
  "outcome": "installed",
  "plugin": "hello-world",
  "version": "1.0.0",
  "vendor": "claude",
  "adapterVersion": "1.0.0",
  "payloadDigest": "8d4aae916cbc30a068b9618e159c3bf12c611dd313200057d662729f5d79deb4",
  "target": "<target-directory>",
  "changedPaths": 2
}
```

Re-running the same command returns `outcome: "unchanged"` when the installed record and managed files still match the shipped bundle.

## Rollback and Recovery

The installer creates `.agent-plugins/install.lock`, stages files on the same filesystem, writes a durable transaction journal, commits deterministic writes, verifies the installed record, and cleans up transaction metadata.

Failure outcomes:

- `failed-before-mutation`, exit `3`: validation, collision, target, lock, or adapter mismatch failed before managed files changed.
- `rolled-back`, exit `4`: a mutation failed and the installer restored the previous managed state.
- `rollback-failed`, exit `5`: rollback could not finish; stderr includes `recoveryJournal` pointing at the preserved journal.

Recovery runbook:

- Stop concurrent installs into the same target.
- Read the JSON envelope from stderr and capture `recoveryJournal` when present.
- Inspect `.agent-plugins/installed/*.json` to identify managed files, source digest, payload digest, and adapter version.
- Compare managed files against the installed record before retrying.
- Retry the same documented install command after the target is stable.

## Compatibility and Upgrade Policy

Current release versions:

| Surface | Version |
| --- | --- |
| Toolkit packages | `0.1.0` |
| Bundle schema | `1.0.0` |
| Claude adapter | `1.0.0` |
| Cursor adapter | `1.0.0` |
| Codex adapter | `1.0.0` |
| Hello-world plugin | `1.0.0` |

The installer accepts an upgrade or reinstall only when the bundle validates against the selected adapter and target preflight succeeds. Adapter or vendor-schema identity mismatches fail before mutation. Plugin version movement is recorded in `.agent-plugins/installed/*.json`; compatibility is determined by bundle integrity and adapter ownership, not by hidden target state.

## Shipped Payloads

| Vendor | Bundle path | Vendor schema | Payload digest |
| --- | --- | --- | --- |
| Claude | `packages/adapter-claude/payloads/hello-world/bundle.json` | `claude-code-plugins-2026-08-10` | `8d4aae916cbc30a068b9618e159c3bf12c611dd313200057d662729f5d79deb4` |
| Cursor | `packages/adapter-cursor/payloads/hello-world/bundle.json` | `cursor-plugins-2026-08-10` | `75649714dfda40f7c158d5712f19411a9bedfcaf72ee5c31f92a991521d2202e` |
| Codex | `packages/adapter-codex/payloads/hello-world/bundle.json` | `codex-plugins-2026-08-10` | `47b9c9a3f30240a8d90da1ff31e791b33179b7ac49c68283d1ad8f0605109ea3` |

Every shipped payload is verified by `pnpm payloads:verify`, CI, and the release-evidence test suite.
