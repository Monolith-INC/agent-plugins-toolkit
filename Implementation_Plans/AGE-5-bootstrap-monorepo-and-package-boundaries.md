# AGE-5 Bootstrap Monorepo And Package Boundaries

Linear: https://linear.app/agentical-monolithics/issue/AGE-5/bootstrap-monorepo-and-package-boundaries

Status at planning time: In Progress

## Goal

Create the initial portable Agent Plugins Toolkit workspace with a pnpm monorepo, package boundaries, example plugin and fixture directories.

## Acceptance Criteria

- Workspace installs cleanly.
- Core, CLI, and testing packages build independently.
- TypeScript strict mode is enabled.
- No client-specific runtime dependency exists in `packages/core`.

## User Stories

AGE-5 is the implementation User Story.

## Implementation Tasks

1. Create the pnpm workspace root.
   - Add `package.json`, `pnpm-workspace.yaml`, shared TypeScript config, and baseline ignore/config files.
   - Add workspace scripts for install validation, build, typecheck, and tests.

2. Create package boundaries.
   - Add `packages/core` for portable manifest, skill, MCP, diagnostics, and inspection primitives.
   - Add `packages/cli` for command entrypoints that depend on `packages/core`.
   - Add `packages/testing` for shared fixtures and test helpers.
   - Ensure each package has its own `package.json`, `tsconfig.json`, and build script.

3. Add initial repository directories.
   - Add `plugins/hello-world`.
   - Add `fixtures/valid`.
   - Add `fixtures/invalid`.
   - Add `docs`.

4. Preserve core portability.
   - Keep `packages/core` free of Codex, Cursor, Claude, or other client-specific runtime dependencies.
   - Put client-specific examples and fixtures outside `packages/core`.

5. Verify.
   - Run install/build checks once pnpm dependencies are declared.
   - Confirm each package builds independently.
   - Confirm TypeScript strict mode is enabled in the shared and package configs.

## Git Plan

Branch conventions confirmed by the user:

- Feature branches: `feature/xxx`
- User Story branches: `story/xxx`
- Main work branch: `main`

AGE-5 is not a parent Feature with child stories, so implementation is on:

- `story/age-5-bootstrap-monorepo-and-package-boundaries`

This branch was created from `main`.
