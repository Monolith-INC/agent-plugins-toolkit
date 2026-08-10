# M4 Release Notes: Vendor Payload Compiler and Transactional Installer

Release date: 2026-08-10

Milestone: [M4 - Vendor Payload Compiler & Transactional Installer](https://linear.app/agentical-monolithics/project/agent-plugins-toolkit-491f93eacad2/overview#milestone-2087dd3f-72b8-433c-a2dc-144591aa64be)

Parent feature: [AGE-13](https://linear.app/agentical-monolithics/issue/AGE-13)

Accepted specs:

- [Feature brief](../../AI_Codex/Features/age-13-vendor-payload-compiler-and-installer.md)
- [Design document](../../AI_Codex/Specs/age-13/design-doc.md)
- [Technical specification](../../AI_Codex/Specs/age-13/tech-spec.md)
- [API contract](../../AI_Codex/Specs/age-13/api-contract.md)
- [Implementation plan](../../AI_Codex/Specs/age-13/implementation-plan.md)

## What Shipped

M4 adds a deterministic release path from canonical portable plugin source to adapter-owned Claude, Cursor, and Codex payloads, then installs those payloads through the common transactional installer exposed by `agent-plugin install`.

Included packages:

- `@agent-plugins/compiler@0.1.0`
- `@agent-plugins/adapter-claude@0.1.0`
- `@agent-plugins/adapter-cursor@0.1.0`
- `@agent-plugins/adapter-codex@0.1.0`
- `@agent-plugins/installer@0.1.0`
- `@agent-plugins/cli@0.1.0`

Shipped bundle versions:

| Vendor | Adapter version | Vendor schema | Plugin | Payload digest |
| --- | --- | --- | --- | --- |
| Claude | `1.0.0` | `claude-code-plugins-2026-08-10` | `hello-world@1.0.0` | `8d4aae916cbc30a068b9618e159c3bf12c611dd313200057d662729f5d79deb4` |
| Cursor | `1.0.0` | `cursor-plugins-2026-08-10` | `hello-world@1.0.0` | `75649714dfda40f7c158d5712f19411a9bedfcaf72ee5c31f92a991521d2202e` |
| Codex | `1.0.0` | `codex-plugins-2026-08-10` | `hello-world@1.0.0` | `47b9c9a3f30240a8d90da1ff31e791b33179b7ac49c68283d1ad8f0605109ea3` |

## Completed Tickets

- [AGE-14](https://linear.app/agentical-monolithics/issue/AGE-14): compiler and installer contracts, merged in [PR #20](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/20)
- [AGE-15](https://linear.app/agentical-monolithics/issue/AGE-15): adapter SDK, merged in [PR #21](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/21)
- [AGE-16](https://linear.app/agentical-monolithics/issue/AGE-16): compiler and shipped payload pipeline, merged in [PR #22](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/22)
- [AGE-17](https://linear.app/agentical-monolithics/issue/AGE-17): Cursor adapter, merged in [PR #23](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/23)
- [AGE-18](https://linear.app/agentical-monolithics/issue/AGE-18): Claude adapter, merged in [PR #24](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/24)
- [AGE-19](https://linear.app/agentical-monolithics/issue/AGE-19): Codex adapter, merged in [PR #25](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/25)
- [AGE-20](https://linear.app/agentical-monolithics/issue/AGE-20): transactional installer, merged in [PR #26](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/26)
- [AGE-21](https://linear.app/agentical-monolithics/issue/AGE-21): single install command, merged in [PR #27](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/27)
- [AGE-22](https://linear.app/agentical-monolithics/issue/AGE-22): release evidence, merged in [PR #28](https://github.com/Monolith-INC/agent-plugins-toolkit/pull/28)
- [AGE-23](https://linear.app/agentical-monolithics/issue/AGE-23): documentation and release notes

## Release Checks

The release branch must pass:

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm payloads:verify
```

`pnpm test` includes documentation evidence that executes the documented install command shape for Claude, Cursor, and Codex against disposable targets, confirms documented bundle paths and digests match the shipped payloads, verifies package publication includes `payloads`, and checks that toolkit provenance stays in `bundle.json` rather than vendor manifests.
