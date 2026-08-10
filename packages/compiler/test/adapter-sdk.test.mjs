import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTABLE_FILE_MODES,
  canonicalMarkdown,
  compilerDiagnosticCodes,
  createJsonPayloadFile,
  createMarkdownPayloadFile,
  createVendorAdapterRegistry,
  failure,
  finalizeVendorBundle,
  formatPayloadPath,
  getVendorAdapter,
  listVendorAdapters,
  success,
  validateInstallPlan,
  validateVendorBundle,
} from "../dist/index.js";

const ZERO_DIGEST = "0".repeat(64);

function makeAdapter(vendor) {
  return {
    vendor,
    adapterVersion: "1.0.0",
    vendorSchemaVersion: "fixture-1",
    compile(plugin) {
      const payload = createJsonPayloadFile({
        path: `.generated/${vendor}/plugin.json`,
        value: {
          name: plugin.manifest.name,
          vendor,
          version: plugin.manifest.version,
        },
      });
      if (!payload.ok) return payload;
      return success({
        plugin: { name: plugin.manifest.name, version: plugin.manifest.version },
        vendor,
        adapter: {
          version: this.adapterVersion,
          vendorSchemaVersion: this.vendorSchemaVersion,
        },
        sourceDigest: plugin.sourceDigest,
        files: [payload.value],
      });
    },
    validate(bundle) {
      return validateVendorBundle(bundle);
    },
    planInstallation(bundle) {
      return success({
        plugin: bundle.manifest.plugin.name,
        version: bundle.manifest.plugin.version,
        vendor,
        bundleDigest: bundle.manifest.payloadDigest,
        writes: bundle.files.map((file) => ({
          source: file.path,
          destination: file.path,
          mode: file.mode,
        })),
      });
    },
  };
}

function canonicalPlugin() {
  return {
    root: "/nonexistent/canonical-source",
    manifest: {
      name: "hello-world",
      version: "1.0.0",
      description: "Fixture plugin.",
    },
    skills: [],
    mcpServers: [],
    rules: [],
    hookIntents: [],
    distribution: {
      schemaVersion: "1.0.0",
      compatibility: {
        bundleSchemaMajor: 1,
        allowDowngradeWithinMajor: false,
      },
    },
    sourceDigest: ZERO_DIGEST,
  };
}

test("registry requires and freezes exactly one complete adapter per vendor", () => {
  const registry = createVendorAdapterRegistry([
    makeAdapter("cursor"),
    makeAdapter("claude"),
    makeAdapter("codex"),
  ]);
  assert.equal(registry.ok, true);
  assert.equal(Object.isFrozen(registry.value), true);
  assert.deepEqual(Object.keys(registry.value), ["claude", "codex", "cursor"]);
  assert.deepEqual(listVendorAdapters(), ["claude", "codex", "cursor"]);
  for (const vendor of listVendorAdapters()) {
    const adapter = getVendorAdapter(registry.value, vendor);
    assert.equal(adapter.vendor, vendor);
    assert.equal(Object.isFrozen(adapter), true);
  }
  assert.equal(getVendorAdapter(registry.value, "cursor").vendor, "cursor");
});

test("registry rejects missing, duplicate, unsupported, and partial adapters as diagnostics", () => {
  const missing = createVendorAdapterRegistry([makeAdapter("claude"), makeAdapter("codex")]);
  assert.equal(missing.ok, false);
  assert.ok(missing.diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.adapterMissing));

  const duplicate = createVendorAdapterRegistry([
    makeAdapter("claude"),
    makeAdapter("claude"),
    makeAdapter("codex"),
    makeAdapter("cursor"),
  ]);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.adapterDuplicate));

  const unsupported = createVendorAdapterRegistry([
    makeAdapter("claude"),
    makeAdapter("codex"),
    makeAdapter("generic"),
  ]);
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.vendorUnsupported));

  const partial = { ...makeAdapter("cursor"), planInstallation: undefined };
  const incomplete = createVendorAdapterRegistry([
    makeAdapter("claude"),
    makeAdapter("codex"),
    partial,
  ]);
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.adapterInvalid));
});

test("format helpers produce canonical JSON, Markdown, paths, modes, and bytes", () => {
  assert.deepEqual(PORTABLE_FILE_MODES, { regular: 0o644, executable: 0o755 });
  assert.equal(Object.isFrozen(PORTABLE_FILE_MODES), true);
  assert.equal(canonicalMarkdown("# Hello\r\n\r\n"), "# Hello\n");
  assert.deepEqual(formatPayloadPath("skills", "hello", "SKILL.md"), {
    ok: true,
    value: "skills/hello/SKILL.md",
  });
  assert.equal(formatPayloadPath("skills", "..", "escape").ok, false);

  const json = createJsonPayloadFile({
    path: "manifest.json",
    value: { z: 1, a: 2 },
  });
  const markdown = createMarkdownPayloadFile({
    path: "skills/hello/SKILL.md",
    content: "# Hello\r\n",
    mode: PORTABLE_FILE_MODES.executable,
  });
  assert.equal(json.ok, true);
  assert.equal(markdown.ok, true);
  assert.equal(new TextDecoder().decode(json.value.content), '{\n  "a": 2,\n  "z": 1\n}\n');
  assert.equal(new TextDecoder().decode(markdown.value.content), "# Hello\n");
  assert.equal(markdown.value.mode, 0o755);
});

test("all registry operations return values that pass common bundle and plan validation", () => {
  const registry = createVendorAdapterRegistry([
    makeAdapter("claude"),
    makeAdapter("codex"),
    makeAdapter("cursor"),
  ]);
  assert.equal(registry.ok, true);

  for (const vendor of listVendorAdapters()) {
    const adapter = getVendorAdapter(registry.value, vendor);
    const compiled = adapter.compile(canonicalPlugin());
    assert.equal(compiled.ok, true);
    const bundle = finalizeVendorBundle(compiled.value);
    assert.equal(bundle.ok, true);
    assert.deepEqual(adapter.validate(bundle.value), []);
    const plan = adapter.planInstallation(bundle.value, { root: "/nonexistent/target" });
    assert.equal(plan.ok, true);
    assert.deepEqual(validateInstallPlan(plan.value, bundle.value), []);
  }
});

test("expected adapter mapping failures are non-throwing diagnostic values", () => {
  const adapter = {
    ...makeAdapter("claude"),
    compile: () => failure({
      severity: "error",
      code: "adapter.mapping.unsupported",
      message: "The canonical construct cannot be represented.",
    }),
  };
  const result = adapter.compile(canonicalPlugin());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "adapter.mapping.unsupported");
});
