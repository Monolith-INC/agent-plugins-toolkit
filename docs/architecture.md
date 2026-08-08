# Agent Plugins Toolkit Architecture

The toolkit starts as a pnpm workspace with three package boundaries:

- `packages/core` contains portable data types and inspection primitives.
- `packages/cli` contains command-line entrypoints and depends on `packages/core`.
- `packages/testing` contains shared fixtures and test helpers.

Client-specific runtime code should stay outside `packages/core`.
