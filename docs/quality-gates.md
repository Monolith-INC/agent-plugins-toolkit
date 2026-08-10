# Quality Gates

Contributor and maintainer checklist for `agent-plugins-toolkit` (AGE-28).

## Required local commands

A clean checkout MUST pass the same commands used in CI:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm payloads:verify
```

Node.js `>=22` and `pnpm@10.14.0` (see root `package.json` `packageManager`) are required.

## CI matrix

GitHub Actions workflow `.github/workflows/ci.yml` runs on every pull request and push to `main` across:

| OS | Node |
| --- | --- |
| Ubuntu | 22 |
| macOS | 22 |
| Windows | 22 |

Failures identify the OS/Node job name. On failure, CI attempts to upload log artifacts for 14 days.

The CI matrix also runs `pnpm payloads:verify` so adapter-owned shipped payloads cannot drift from canonical source.

## Platform-specific filesystem notes

- Symlink containment and link-escape tests (AGE-26/AGE-27) run where the platform supports creating symlinks without elevation.
- Windows runners may skip or fail symlink creation without Developer Mode; prefer asserting portable containment helpers and documenting platform limits in the failing test message rather than silently weakening checks.
- Do not merge OS-specific workarounds that disable fixture assertions without an accompanying test proving the intended behavior on at least one platform.

## Guardrails

- Do not commit generated golden files that were not produced by `pnpm test` on a clean tree.
- Do not commit adapter-owned payloads unless `pnpm payloads:verify` passes after generation.
- Prefer deterministic fixtures under `fixtures/` over captured machine-specific paths.
- Treat exit codes and diagnostic codes as versioned interfaces; changes require tests.
