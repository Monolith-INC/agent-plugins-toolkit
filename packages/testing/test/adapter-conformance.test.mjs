import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createJsonPayloadFile,
  createVendorAdapterRegistry,
  getVendorAdapter,
  listVendorAdapters,
  success,
  validateVendorBundle,
} from "@agent-plugins/compiler";

import {
  assertAdapterModuleHasNoFilesystemEffects,
  assertCompleteVendorConformance,
  assertGoldenPayload,
  assertVendorAdapterConformance,
} from "../dist/index.js";

const ZERO_DIGEST = "0".repeat(64);

function makeCanonicalPlugin(root) {
  return {
    root,
    manifest: {
      name: "hello-world",
      version: "1.0.0",
      description: "Conformance fixture.",
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

function makeAdapter(vendor) {
  return {
    vendor,
    adapterVersion: "1.0.0",
    vendorSchemaVersion: "fixture-1",
    compile(plugin) {
      const file = createJsonPayloadFile({
        path: `${vendor}/plugin.json`,
        value: {
          name: plugin.manifest.name,
          vendor,
          version: plugin.manifest.version,
        },
      });
      if (!file.ok) return file;
      return success({
        plugin: { name: plugin.manifest.name, version: plugin.manifest.version },
        vendor,
        adapter: {
          version: this.adapterVersion,
          vendorSchemaVersion: this.vendorSchemaVersion,
        },
        sourceDigest: plugin.sourceDigest,
        files: [file.value],
      });
    },
    validate: validateVendorBundle,
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

test("the identical conformance harness exercises all three registered adapters", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-adapter-conformance-"));
  const source = join(root, "source");
  const target = join(root, "target");
  mkdirSync(source);
  mkdirSync(target);
  writeFileSync(join(source, "sentinel.txt"), "canonical source\n");
  writeFileSync(join(target, "unrelated.txt"), "preserve me\n");

  const registry = createVendorAdapterRegistry([
    makeAdapter("claude"),
    makeAdapter("codex"),
    makeAdapter("cursor"),
  ]);
  assert.equal(registry.ok, true);

  const evidence = listVendorAdapters().map((vendor) =>
    assertVendorAdapterConformance({
      adapter: getVendorAdapter(registry.value, vendor),
      plugin: makeCanonicalPlugin(source),
      target: { root: target },
    }),
  );

  assertCompleteVendorConformance(evidence);
  assert.equal(readFileSync(join(source, "sentinel.txt"), "utf8"), "canonical source\n");
  assert.equal(readFileSync(join(target, "unrelated.txt"), "utf8"), "preserve me\n");
  for (const entry of evidence) assertGoldenPayload(entry.bundle, entry.golden);
});

test("golden payload assertions detect byte, path, digest, length, and mode drift", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-adapter-golden-"));
  const adapter = makeAdapter("claude");
  const evidence = assertVendorAdapterConformance({
    adapter,
    plugin: makeCanonicalPlugin(root),
    target: { root: join(root, "target") },
  });

  const changed = [
    {
      ...evidence.golden[0],
      contentBase64: Buffer.from("changed\n").toString("base64"),
      mode: 0o755,
    },
  ];
  assert.throws(() => assertGoldenPayload(evidence.bundle, changed));
});

test("conformance detects compile, validate, and plan filesystem writes", () => {
  for (const operation of ["compile", "validate", "planInstallation"]) {
    const root = mkdtempSync(join(tmpdir(), `agent-adapter-${operation}-`));
    const source = join(root, "source");
    const target = join(root, "target");
    mkdirSync(source);
    mkdirSync(target);
    const base = makeAdapter("cursor");
    const mutating = {
      ...base,
      ...(operation === "compile"
        ? {
            compile(plugin) {
              writeFileSync(join(plugin.root, "forbidden.txt"), "mutation\n");
              return base.compile(plugin);
            },
          }
        : {}),
      ...(operation === "validate"
        ? {
            validate(bundle) {
              writeFileSync(join(source, "forbidden.txt"), "mutation\n");
              return base.validate(bundle);
            },
          }
        : {}),
      ...(operation === "planInstallation"
        ? {
            planInstallation(bundle, installTarget) {
              writeFileSync(join(installTarget.root, "forbidden.txt"), "mutation\n");
              return base.planInstallation(bundle, installTarget);
            },
          }
        : {}),
    };

    assert.throws(
      () => assertVendorAdapterConformance({
        adapter: mutating,
        plugin: makeCanonicalPlugin(source),
        target: { root: target },
      }),
      operation === "planInstallation"
        ? /mutated the installation target/
        : /mutated the build filesystem/,
    );
  }
});

test("adapter module purity check rejects filesystem and process mutation capabilities", () => {
  assert.doesNotThrow(() =>
    assertAdapterModuleHasNoFilesystemEffects(
      'import { stableJson } from "@agent-plugins/compiler";\nexport const render = stableJson;',
    ),
  );
  for (const source of [
    'import { writeFileSync } from "node:fs";',
    'import fs from "fs";',
    'import { spawn } from "node:child_process";',
    'process.chdir("/tmp");',
    'Deno.writeTextFile("x", "y");',
  ]) {
    assert.throws(() => assertAdapterModuleHasNoFilesystemEffects(source));
  }
});
