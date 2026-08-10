import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  finalizeVendorBundle,
  normalizeCanonicalPlugin,
  readVendorBundle,
} from "@agent-plugins/compiler";
import {
  assertAdapterModuleHasNoFilesystemEffects,
  assertVendorAdapterConformance,
} from "@agent-plugins/testing";

import {
  CURSOR_ADAPTER_VERSION,
  CURSOR_SCHEMA_EVIDENCE,
  CURSOR_SCHEMA_VERSION,
  compileCursorPayload,
  cursorAdapter,
  planCursorInstallation,
  validateCursorBundle,
} from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const helloWorldRoot = join(repositoryRoot, "plugins", "hello-world");

function richCanonical(overrides = {}) {
  return {
    root: helloWorldRoot,
    manifest: { name: "hello-world", version: "1.0.0", description: "Cursor fixture." },
    skills: [{
      name: "hello-world",
      path: "skills/hello-world/SKILL.md",
      description: "Say hello.",
      content: "---\nname: hello-world\ndescription: Say hello.\n---\n\n# Hello\n",
    }],
    mcpServers: [{ transport: "stdio", name: "local", command: "node", args: ["server.mjs"] }],
    rules: [{
      id: "safe-edits",
      description: "Keep edits safe.",
      activation: "always",
      fileGlobs: ["src/**"],
      content: "# Safe edits\n",
    }],
    hookIntents: [{
      id: "audit-shell",
      lifecycle: "before-tool",
      toolKinds: ["shell"],
      executable: "scripts/audit.sh",
      arguments: ["--check"],
      timeoutSeconds: 10,
    }],
    distribution: {
      schemaVersion: "1.0.0",
      compatibility: { bundleSchemaMajor: 1, allowDowngradeWithinMajor: false },
    },
    sourceDigest: "0".repeat(64),
    ...overrides,
  };
}

test("Cursor schema evidence and adapter identity are pinned", () => {
  assert.equal(CURSOR_ADAPTER_VERSION, "1.0.0");
  assert.equal(CURSOR_SCHEMA_VERSION, "cursor-plugins-2026-08-10");
  assert.deepEqual(CURSOR_SCHEMA_EVIDENCE, [
    "https://cursor.com/docs/reference/plugins",
    "https://cursor.com/docs/hooks",
  ]);
  assert.equal(cursorAdapter.vendor, "cursor");
});

test("Cursor adapter renders complete native manifest, Skill, rule, hook, and MCP payload", () => {
  const draft = compileCursorPayload(richCanonical());
  assert.equal(draft.ok, true);
  const bundle = finalizeVendorBundle(draft.value);
  assert.equal(bundle.ok, true);
  assert.deepEqual(bundle.value.files.map((file) => file.path), [
    ".cursor-plugin/plugin.json",
    "hooks/hooks.json",
    "mcp.json",
    "rules/safe-edits.mdc",
    "skills/hello-world/SKILL.md",
  ]);
  assert.deepEqual(validateCursorBundle(bundle.value), []);
  const manifest = JSON.parse(new TextDecoder().decode(bundle.value.files[0].content));
  assert.deepEqual(manifest, {
    description: "Cursor fixture.",
    hooks: "hooks/hooks.json",
    mcpServers: "mcp.json",
    name: "hello-world",
    rules: "rules/",
    skills: "skills/",
    version: "1.0.0",
  });
  const hooks = JSON.parse(new TextDecoder().decode(bundle.value.files[1].content));
  assert.deepEqual(hooks, {
    hooks: { beforeShellExecution: [{ command: '"scripts/audit.sh" "--check"', timeout: 10 }] },
    version: 1,
  });
  const plan = planCursorInstallation(bundle.value, { root: "/unused" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.value.writes.map((write) => write.destination), bundle.value.files.map((file) => file.path));
});

test("Cursor adapter rejects unsupported mappings and poisoned payloads as diagnostics", () => {
  const configPath = compileCursorPayload(richCanonical({
    mcpServers: [{ transport: "config-path", name: "opaque", path: "vendor.json" }],
  }));
  assert.equal(configPath.ok, false);
  assert.equal(configPath.diagnostics[0].code, "cursor.mcp.unsupported");

  const missingDescription = compileCursorPayload(richCanonical({
    rules: [{ id: "requested", activation: "model-decides", fileGlobs: [], content: "Use judgment.\n" }],
  }));
  assert.equal(missingDescription.ok, false);
  assert.equal(missingDescription.diagnostics[0].code, "cursor.rule.unsupported");

  const valid = compileCursorPayload(richCanonical());
  assert.equal(valid.ok, true);
  const bundle = finalizeVendorBundle(valid.value);
  assert.equal(bundle.ok, true);
  const poisoned = {
    ...bundle.value,
    files: [{ ...bundle.value.files[0], path: "cursor-owned-outside-adapter.json" }, ...bundle.value.files.slice(1)],
  };
  assert.ok(validateCursorBundle(poisoned).length > 0);
});

test("Cursor adapter passes the shared pure conformance harness", () => {
  const canonical = normalizeCanonicalPlugin(helloWorldRoot);
  assert.equal(canonical.ok, true);
  const evidence = assertVendorAdapterConformance({
    adapter: cursorAdapter,
    plugin: canonical.value,
    target: { root: join(mkdtempSync(join(tmpdir(), "cursor-target-")), "install") },
  });
  assert.equal(evidence.vendor, "cursor");

  const source = readFileSync(join(packageRoot, "src", "index.ts"), "utf8");
  assertAdapterModuleHasNoFilesystemEffects(source, "Cursor adapter");
});

test("shipped hello-world Cursor payload is valid and complete", () => {
  const shipped = readVendorBundle(join(packageRoot, "payloads", "hello-world"));
  assert.equal(shipped.ok, true);
  assert.deepEqual(validateCursorBundle(shipped.value), []);
});
