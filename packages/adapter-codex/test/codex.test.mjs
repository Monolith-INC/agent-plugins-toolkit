import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { finalizeVendorBundle, normalizeCanonicalPlugin, readVendorBundle } from "@agent-plugins/compiler";
import { assertAdapterModuleHasNoFilesystemEffects, assertVendorAdapterConformance } from "@agent-plugins/testing";
import {
  CODEX_ADAPTER_VERSION,
  CODEX_SCHEMA_EVIDENCE,
  CODEX_SCHEMA_VERSION,
  codexAdapter,
  compileCodexPayload,
  planCodexInstallation,
  validateCodexBundle,
} from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const helloWorldRoot = join(repositoryRoot, "plugins", "hello-world");

function richCanonical(overrides = {}) {
  return {
    root: helloWorldRoot,
    manifest: { name: "hello-world", version: "1.0.0", description: "Codex fixture." },
    skills: [{
      name: "hello-world",
      path: "skills/hello-world/SKILL.md",
      description: "Say hello.",
      content: "---\nname: hello-world\ndescription: Say hello.\n---\n\n# Hello\n",
    }],
    mcpServers: [{ transport: "stdio", name: "local", command: "node", args: ["server.mjs"] }],
    rules: [],
    hookIntents: [{
      id: "audit-shell",
      lifecycle: "before-tool",
      toolKinds: ["shell"],
      executable: "scripts/audit.sh",
      arguments: ["--check"],
      timeoutSeconds: 10,
    }],
    distribution: { schemaVersion: "1.0.0", compatibility: { bundleSchemaMajor: 1, allowDowngradeWithinMajor: false } },
    sourceDigest: "0".repeat(64),
    ...overrides,
  };
}

test("Codex schema evidence and adapter identity are pinned", () => {
  assert.equal(CODEX_ADAPTER_VERSION, "1.0.0");
  assert.equal(CODEX_SCHEMA_VERSION, "codex-plugins-2026-08-10");
  assert.deepEqual(CODEX_SCHEMA_EVIDENCE, [
    "https://developers.openai.com/plugins/build/plugins",
    "https://learn.chatgpt.com/docs/hooks",
  ]);
  assert.equal(codexAdapter.vendor, "codex");
});

test("Codex adapter renders native manifest, Skill, hook, and MCP payload", () => {
  const draft = compileCodexPayload(richCanonical());
  assert.equal(draft.ok, true);
  const bundle = finalizeVendorBundle(draft.value);
  assert.equal(bundle.ok, true);
  assert.deepEqual(bundle.value.files.map((file) => file.path), [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "hooks/hooks.json",
    "skills/hello-world/SKILL.md",
  ]);
  assert.deepEqual(validateCodexBundle(bundle.value), []);
  const manifest = JSON.parse(new TextDecoder().decode(bundle.value.files[0].content));
  assert.deepEqual(manifest, {
    description: "Codex fixture.",
    hooks: "./hooks/hooks.json",
    mcpServers: "./.mcp.json",
    name: "hello-world",
    skills: "./skills/",
    version: "1.0.0",
  });
  const mcp = JSON.parse(new TextDecoder().decode(bundle.value.files[1].content));
  assert.deepEqual(mcp, { mcp_servers: { local: { args: ["server.mjs"], command: "node" } } });
  const hooks = JSON.parse(new TextDecoder().decode(bundle.value.files[2].content));
  assert.deepEqual(hooks, {
    hooks: { PreToolUse: [{ hooks: [{ command: '"scripts/audit.sh" "--check"', timeout: 10, type: "command" }], matcher: "^Bash$" }] },
  });
  const plan = planCodexInstallation(bundle.value, { root: "/unused" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.value.writes.map((write) => write.destination), bundle.value.files.map((file) => file.path));
});

test("Codex adapter rejects unrepresentable constructs and poisoned payloads", () => {
  const rule = compileCodexPayload(richCanonical({ rules: [{ id: "safe-edits", activation: "always", fileGlobs: [], content: "Safe.\n" }] }));
  assert.equal(rule.ok, false);
  assert.equal(rule.diagnostics[0].code, "codex.rule.unsupported");
  const fileRead = compileCodexPayload(richCanonical({
    hookIntents: [{ id: "read", lifecycle: "before-tool", toolKinds: ["file-read"], executable: "audit", arguments: [] }],
  }));
  assert.equal(fileRead.ok, false);
  assert.equal(fileRead.diagnostics[0].code, "codex.hook.unsupported");
  const remote = compileCodexPayload(richCanonical({ mcpServers: [{ transport: "streamable-http", name: "remote", url: "https://example.com/mcp" }] }));
  assert.equal(remote.ok, false);
  assert.equal(remote.diagnostics[0].code, "codex.mcp.unsupported");

  const valid = compileCodexPayload(richCanonical());
  assert.equal(valid.ok, true);
  const bundle = finalizeVendorBundle(valid.value);
  assert.equal(bundle.ok, true);
  const poisoned = { ...bundle.value, files: [{ ...bundle.value.files[0], path: "codex-owned-outside-adapter.json" }, ...bundle.value.files.slice(1)] };
  assert.ok(validateCodexBundle(poisoned).length > 0);
});

test("Codex adapter passes the shared pure conformance harness", () => {
  const canonical = normalizeCanonicalPlugin(helloWorldRoot);
  assert.equal(canonical.ok, true);
  const evidence = assertVendorAdapterConformance({
    adapter: codexAdapter,
    plugin: canonical.value,
    target: { root: join(mkdtempSync(join(tmpdir(), "codex-target-")), "install") },
  });
  assert.equal(evidence.vendor, "codex");
  assertAdapterModuleHasNoFilesystemEffects(readFileSync(join(packageRoot, "src", "index.ts"), "utf8"), "Codex adapter");
});

test("shipped hello-world Codex payload is valid and complete", () => {
  const shipped = readVendorBundle(join(packageRoot, "payloads", "hello-world"));
  assert.equal(shipped.ok, true);
  assert.deepEqual(validateCodexBundle(shipped.value), []);
});
