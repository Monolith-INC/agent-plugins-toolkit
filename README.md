# agent-plugins-toolkit

Reference implementation and CLI for the Agent Plugins v1.0.0 portable architecture.

## Workspace

This repository is a pnpm workspace with three initial packages:

- `packages/core` for portable Agent Plugins primitives.
- `packages/cli` for command-line entrypoints.
- `packages/testing` for shared test helpers and fixtures.

## Commands

```sh
pnpm install
pnpm build
pnpm build:core
pnpm build:cli
pnpm build:testing
pnpm typecheck
pnpm test
```
