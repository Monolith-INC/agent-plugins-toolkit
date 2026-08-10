# AGE-13 — Vendor Payload Compiler and Transactional Installer

## Authority and outcome

Implement the accepted contracts in `AI_Codex/Specs/age-13/` without changing their observable behavior. The completed Feature compiles one canonical plugin source into deterministic, adapter-owned Claude, Cursor, and Codex payloads and installs exactly one shipped payload through the common transactional `agent-plugin install` command.

## Confirmed git topology

- Main work branch and final PR target: `main`
- Feature integration branch: `feature/age-13-vendor-payload-compiler-installer`
- Child Story branches: `feature/age-<ticket>-<short-description>` (the repository hook rejects the workflow's preferred `story/` prefix)
- Every Story starts from the Feature branch, is re-synchronized with it before review, and targets the Feature branch.
- The Feature targets `main` only after AGE-14 through AGE-23 are merged and the finish-feature-development workflow is invoked.

## Story execution checklist

### AGE-14 — Contracts

- [x] Create immutable canonical, digest, path, bundle, plan, record, journal, and result contracts outside core.
- [x] Implement branded constructors, deterministic encodings, common validation, and diagnostic families.
- [x] Prove normalized relative-path containment, uniqueness, and the portable-core dependency boundary.
- [x] Build, typecheck, and test affected packages; merge PR #20 from `story/age-14-contracts` into the Feature branch.

### AGE-15 — Adapter SDK

- [x] Define the complete pure `VendorAdapter` boundary and exact three-vendor frozen registry.
- [x] Add deterministic JSON, Markdown, line-ending, path, and mode helpers.
- [x] Add shared adapter conformance and no-filesystem-side-effect tests.
- [x] Build, typecheck, and test affected packages; merge PR #21 from `feature/age-15-adapter-sdk` into the Feature branch.

### AGE-16 — Compiler and shipped payload pipeline

- [x] Normalize error-free portable inspection into a canonical plugin and source digest.
- [x] Implement staged, verified, atomic compilation and prior-output preservation on failure.
- [x] Implement isolated regenerate-and-diff verification and payload build/verify scripts.
- [ ] Build, typecheck, and test affected packages; merge `feature/age-16-deterministic-compiler` into the Feature branch.

### AGE-17 — Cursor adapter

- [x] Pin Cursor schema evidence and keep all Cursor names, paths, frontmatter, events, rendering, validation, and plan rules inside the adapter.
- [x] Generate, validate, ship, and drift-protect the hello-world Cursor payload.
- [x] Pass the shared conformance suite.
- [ ] Merge `feature/age-17-cursor-adapter` into the Feature branch.

### AGE-18 — Claude adapter

- [ ] Pin Claude schema evidence and keep all Claude names, paths, events, rendering, validation, and plan rules inside the adapter.
- [ ] Generate, validate, ship, and drift-protect the hello-world Claude payload.
- [ ] Pass the shared conformance suite; merge `feature/age-18-claude-adapter` into the Feature branch.

### AGE-19 — Codex adapter

- [ ] Pin Codex schema evidence and keep all Codex names, paths, matchers, events, rendering, validation, and plan rules inside the adapter.
- [ ] Generate, validate, ship, and drift-protect the hello-world Codex payload.
- [ ] Pass the shared conformance suite; merge `feature/age-19-codex-adapter` into the Feature branch.

### AGE-20 — Transactional installer

- [ ] Implement bundle/plan/target preflight, digest and symlink checks, collision handling, and an exclusive target lock.
- [ ] Implement same-filesystem staging, durable journal entries, deterministic commit, installed-record verification, and cleanup.
- [ ] Implement idempotent reinstall, upgrade/removal of stale owned files, reverse rollback, and preserved recovery journals.
- [ ] Cover every mutation fault point and exact managed-state restoration; merge `feature/age-20-transactional-installer` into the Feature branch.

### AGE-21 — Single install command

- [ ] Add strict parsing for exactly one plugin, vendor, and target with the specified JSON envelopes and exit codes.
- [ ] Resolve only shipped verified bundles and call only the shared installer; expose no alternate install/activation path.
- [ ] Cover all three vendors and failure result variants; merge `feature/age-21-install-command` into the Feature branch.

### AGE-22 — Release evidence

- [ ] Complete conformance, byte/mode drift, traversal, Unicode, symlink, poisoned-bundle, permission, collision, and lock tests.
- [ ] Complete install/reinstall/upgrade/downgrade-policy/failed-upgrade lifecycle tests for every vendor.
- [ ] Prove installation imports no compiler, performs no network delivery, and executes no plugin content.
- [ ] Run cross-platform quality gates; merge `feature/age-22-release-evidence` into the Feature branch.

### AGE-23 — Documentation and release

- [ ] Document only canonical source to compiler to shipped adapter payload to transactional install.
- [ ] Publish authoring, adapter conformance, compatibility, rollback/recovery, and one-command installation guidance.
- [ ] Update README, changelog, release notes, versions, payload digests, milestone/spec/ticket links, and command verification.
- [ ] Run the full milestone acceptance audit; merge `feature/age-23-docs-release` into the Feature branch.

## Feature completion gates

- [ ] `pnpm build`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm payloads:verify`
- [ ] Three-vendor isolated install, unchanged reinstall, upgrade, failed-upgrade rollback, and unrelated-file preservation evidence
- [ ] Generated payload diff is empty and every adapter passes the same contract suite
- [ ] Documentation commands and JSON examples match runtime output
- [ ] AGE-14 through AGE-23 are complete and merged into the Feature branch
- [ ] Invoke finish-feature-development for the Feature-to-`main` closeout
