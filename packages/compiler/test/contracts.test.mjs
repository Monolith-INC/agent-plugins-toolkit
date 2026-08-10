import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADAPTER_CONTRACT_VERSION,
  BUNDLE_SCHEMA_VERSION,
  CANONICAL_SCHEMA_VERSION,
  VENDOR_IDS,
  canonicalText,
  compilerDiagnosticCodes,
  computePayloadDigest,
  createPayloadFile,
  finalizeVendorBundle,
  parsePortableFileMode,
  parseRelativePayloadPath,
  parseSha256,
  parseVendorBundleManifest,
  parseVendorId,
  sha256,
  stableJson,
  validateInstallPlan,
  validateVendorBundle,
} from "../dist/index.js";

const ZERO_DIGEST = "0".repeat(64);

test("contract versions and the complete vendor set are closed and pinned", () => {
  assert.equal(CANONICAL_SCHEMA_VERSION, "1.0.0");
  assert.equal(ADAPTER_CONTRACT_VERSION, "1.0.0");
  assert.equal(BUNDLE_SCHEMA_VERSION, "1.0.0");
  assert.deepEqual(VENDOR_IDS, ["claude", "codex", "cursor"]);
  assert.equal(Object.isFrozen(VENDOR_IDS), true);

  assert.equal(parseVendorId("claude").ok, true);
  assert.equal(parseVendorId("codex").ok, true);
  assert.equal(parseVendorId("cursor").ok, true);
  const unsupported = parseVendorId("generic");
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.diagnostics[0].code, compilerDiagnosticCodes.vendorUnsupported);
});

test("branded payload paths reject escapes, ambiguity, and non-normalized Unicode", () => {
  for (const path of [
    "",
    "/absolute",
    "C:/absolute",
    "../escape",
    "a/../escape",
    "a/./b",
    "a//b",
    "a\\b",
    "a\0b",
    "cafe\u0301/file",
  ]) {
    const parsed = parseRelativePayloadPath(path);
    assert.equal(parsed.ok, false, `expected rejection for ${JSON.stringify(path)}`);
    assert.equal(parsed.diagnostics[0].code, compilerDiagnosticCodes.pathInvalid);
  }

  assert.deepEqual(parseRelativePayloadPath("café/file.txt"), {
    ok: true,
    value: "café/file.txt",
  });
});

test("digest and portable-mode constructors return diagnostics instead of throwing", () => {
  assert.equal(parseSha256(ZERO_DIGEST).ok, true);
  assert.equal(parseSha256("ABC").ok, false);
  assert.equal(parsePortableFileMode(0o644).ok, true);
  assert.equal(parsePortableFileMode(0o755).ok, true);
  assert.equal(parsePortableFileMode(0o777).ok, false);
});

test("canonical text and JSON have stable bytes", () => {
  assert.equal(canonicalText("\uFEFFhello\r\nworld\r\n\r\n"), "hello\nworld\n");
  assert.equal(
    stableJson({ z: 1, nested: { z: false, a: true }, a: [3, 2, 1] }),
    '{\n  "a": [\n    3,\n    2,\n    1\n  ],\n  "nested": {\n    "a": true,\n    "z": false\n  },\n  "z": 1\n}\n',
  );
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("payload digest encoding has a fixed compatibility vector", () => {
  const alpha = createPayloadFile({ path: "a.txt", content: "alpha" });
  const binary = createPayloadFile({
    path: "bin/run",
    content: new Uint8Array([0, 1, 2]),
    mode: 0o755,
  });
  assert.equal(alpha.ok, true);
  assert.equal(binary.ok, true);
  assert.equal(alpha.value.sha256, "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060");
  assert.equal(binary.value.sha256, "ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc");
  assert.equal(
    computePayloadDigest([alpha.value, binary.value]),
    "718b71972c3a70d73f8d0fea1d4ad81bfe7086426783f8004f27b683189fac71",
  );
});

test("a complete bundle is finalized in lexical order and validates without execution", () => {
  const skill = createPayloadFile({
    path: "skills/hello/SKILL.md",
    content: "---\nname: hello\ndescription: Say hello.\n---\n\n# Hello",
  });
  const manifest = createPayloadFile({
    path: ".vendor-plugin/plugin.json",
    content: stableJson({ name: "hello-world", version: "1.0.0" }),
  });
  assert.equal(skill.ok, true);
  assert.equal(manifest.ok, true);

  const bundle = finalizeVendorBundle({
    plugin: { name: "hello-world", version: "1.0.0" },
    vendor: "claude",
    adapter: { version: "1.0.0", vendorSchemaVersion: "2026-08-10" },
    sourceDigest: ZERO_DIGEST,
    files: [skill.value, manifest.value],
  });
  assert.equal(bundle.ok, true);
  assert.deepEqual(
    bundle.value.files.map((file) => file.path),
    [".vendor-plugin/plugin.json", "skills/hello/SKILL.md"],
  );
  assert.deepEqual(validateVendorBundle(bundle.value), []);

  const tampered = {
    ...bundle.value,
    files: [
      { ...bundle.value.files[0], content: new TextEncoder().encode("edited\n") },
      bundle.value.files[1],
    ],
  };
  assert.ok(
    validateVendorBundle(tampered).some(
      (entry) => entry.code === compilerDiagnosticCodes.fileDigestMismatch,
    ),
  );

  const invalidSchema = {
    ...bundle.value,
    manifest: { ...bundle.value.manifest, schemaVersion: "2.0.0" },
  };
  assert.ok(
    validateVendorBundle(invalidSchema).some(
      (entry) => entry.code === compilerDiagnosticCodes.manifestInvalid,
    ),
  );
});

test("closed bundle manifests reject unknown fields and unsafe descriptor paths", () => {
  const base = {
    schemaVersion: "1.0.0",
    plugin: { name: "hello-world", version: "1.0.0" },
    vendor: "codex",
    adapter: { version: "1.0.0", vendorSchemaVersion: "2026-08-10" },
    sourceDigest: ZERO_DIGEST,
    payloadDigest: ZERO_DIGEST,
    files: [],
  };
  assert.equal(parseVendorBundleManifest(base).ok, true);

  const unknown = parseVendorBundleManifest({ ...base, postInstall: "generate" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.diagnostics[0].code, compilerDiagnosticCodes.manifestUnknownField);

  const unsafe = parseVendorBundleManifest({
    ...base,
    files: [{ path: "../escape", sha256: ZERO_DIGEST, bytes: 0, mode: 0o644 }],
  });
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.pathInvalid));
});

test("installation plans cover each source once with unique contained destinations", () => {
  const file = createPayloadFile({ path: "skills/hello/SKILL.md", content: "hello" });
  assert.equal(file.ok, true);
  const finalized = finalizeVendorBundle({
    plugin: { name: "hello-world", version: "1.0.0" },
    vendor: "cursor",
    adapter: { version: "1.0.0", vendorSchemaVersion: "2026-08-10" },
    sourceDigest: ZERO_DIGEST,
    files: [file.value],
  });
  assert.equal(finalized.ok, true);

  const validPlan = {
    plugin: "hello-world",
    version: "1.0.0",
    vendor: "cursor",
    bundleDigest: finalized.value.manifest.payloadDigest,
    writes: [
      {
        source: file.value.path,
        destination: file.value.path,
        mode: 0o644,
      },
    ],
  };
  assert.deepEqual(validateInstallPlan(validPlan, finalized.value), []);

  const invalidPlan = {
    ...validPlan,
    writes: [
      validPlan.writes[0],
      { ...validPlan.writes[0], destination: "../escape", mode: 0o777 },
    ],
  };
  const diagnostics = validateInstallPlan(invalidPlan, finalized.value);
  assert.ok(diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.planSourceDuplicate));
  assert.ok(diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.pathInvalid));
  assert.ok(diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.fileModeInvalid));
});

test("portable core has no compiler, adapter, installer, or CLI dependency", () => {
  const packageJson = readFileSync(new URL("../../core/package.json", import.meta.url), "utf8");
  const source = readFileSync(new URL("../../core/src/index.ts", import.meta.url), "utf8");
  for (const forbidden of ["@agent-plugins/compiler", "adapter-claude", "adapter-cursor", "adapter-codex", "@agent-plugins/installer", "@agent-plugins/cli"]) {
    assert.equal(packageJson.includes(forbidden), false, `core package references ${forbidden}`);
    assert.equal(source.includes(forbidden), false, `core source references ${forbidden}`);
  }
});
