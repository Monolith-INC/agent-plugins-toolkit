import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CANONICAL_DISTRIBUTION_EXTENSION,
  compilerDiagnosticCodes,
  createJsonPayloadFile,
  createMarkdownPayloadFile,
  createVendorAdapterRegistry,
  createVendorCompiler,
  normalizeCanonicalPlugin,
  readVendorBundle,
  success,
  validateVendorBundle,
} from "../dist/index.js";

function writeCanonicalPlugin(root, version = "1.0.0") {
  mkdirSync(join(root, "skills", "hello"), { recursive: true });
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({
      version,
      name: "hello-world",
      description: "Compiler fixture.",
      extensions: {
        [CANONICAL_DISTRIBUTION_EXTENSION]: {
          hookIntents: [{
            id: "audit-shell",
            lifecycle: "before-tool",
            toolKinds: ["shell"],
            executable: "scripts/audit.sh",
            arguments: ["--check"],
            timeoutSeconds: 10,
          }],
          rules: [{
            id: "safe-edits",
            activation: "always",
            fileGlobs: ["src/**", "docs/**"],
            content: "# Safe edits\r\n\r\n",
          }],
          compatibility: { allowDowngradeWithinMajor: true },
        },
      },
    }, null, 4),
  );
  writeFileSync(
    join(root, "skills", "hello", "SKILL.md"),
    "\uFEFF---\r\nname: hello\r\ndescription: Say hello.\r\n---\r\n\r\n# Hello\r\n\r\n",
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.mjs"] } } }),
  );
}

function makeAdapter(vendor) {
  const adapterVersion = "1.0.0";
  const vendorSchemaVersion = "fixture-1";
  return {
    vendor,
    adapterVersion,
    vendorSchemaVersion,
    compile(plugin) {
      const identity = createJsonPayloadFile({
        path: `.fixture-${vendor}/plugin.json`,
        value: {
          name: plugin.manifest.name,
          sourceDigest: plugin.sourceDigest,
          version: plugin.manifest.version,
        },
      });
      if (!identity.ok) return identity;
      const skillResults = plugin.skills.map((skill) =>
        createMarkdownPayloadFile({ path: skill.path, content: skill.content }),
      );
      const diagnostics = skillResults.flatMap((result) => result.ok ? [] : result.diagnostics);
      if (diagnostics.length > 0) return { ok: false, diagnostics };
      return success({
        plugin: { name: plugin.manifest.name, version: plugin.manifest.version },
        vendor,
        adapter: { version: adapterVersion, vendorSchemaVersion },
        sourceDigest: plugin.sourceDigest,
        files: [identity.value, ...skillResults.map((result) => result.value)],
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

function registry() {
  const result = createVendorAdapterRegistry([
    makeAdapter("claude"),
    makeAdapter("codex"),
    makeAdapter("cursor"),
  ]);
  assert.equal(result.ok, true);
  return result.value;
}

function snapshot(root, prefix = "") {
  return readdirSync(root).sort().flatMap((entry) => {
    const path = join(root, entry);
    const relative = prefix === "" ? entry : `${prefix}/${entry}`;
    const stat = lstatSync(path);
    if (stat.isDirectory()) return snapshot(path, relative);
    return [{
      path: relative,
      mode: stat.mode & 0o777,
      bytes: readFileSync(path).toString("base64"),
    }];
  });
}

test("canonical normalization is semantic, ordered, and vendor-neutral", () => {
  const source = mkdtempSync(join(tmpdir(), "agent-canonical-"));
  writeCanonicalPlugin(source);
  const first = normalizeCanonicalPlugin(source);
  assert.equal(first.ok, true);
  assert.equal(first.value.skills[0].content.endsWith("\n"), true);
  assert.equal(first.value.skills[0].content.includes("\r"), false);
  assert.deepEqual(first.value.rules.map((rule) => rule.id), ["safe-edits"]);
  assert.deepEqual(first.value.rules[0].fileGlobs, ["docs/**", "src/**"]);
  assert.deepEqual(first.value.hookIntents.map((hook) => hook.id), ["audit-shell"]);
  assert.equal(first.value.distribution.compatibility.allowDowngradeWithinMajor, true);

  writeCanonicalPlugin(source);
  const second = normalizeCanonicalPlugin(source);
  assert.equal(second.ok, true);
  assert.equal(second.value.sourceDigest, first.value.sourceDigest);
});

test("invalid canonical input and unknown vendors fail before output mutation", () => {
  const source = mkdtempSync(join(tmpdir(), "agent-invalid-canonical-"));
  const output = join(mkdtempSync(join(tmpdir(), "agent-invalid-output-")), "bundle");
  writeFileSync(join(source, "plugin.json"), JSON.stringify({ name: "INVALID", version: "1" }));
  const compiler = createVendorCompiler(registry());
  const invalid = compiler.compilePlugin({ source, vendor: "claude", output });
  assert.equal(invalid.ok, false);
  assert.equal(readdirSync(join(output, ".."), { withFileTypes: true }).some((entry) => entry.name === "bundle"), false);

  const unsupported = compiler.compilePlugin({ source, vendor: "generic", output });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.diagnostics[0].code, compilerDiagnosticCodes.vendorUnsupported);
});

test("compilation is deterministic, verified, and atomically restores prior output on failure", () => {
  const source = mkdtempSync(join(tmpdir(), "agent-compile-source-"));
  const output = join(mkdtempSync(join(tmpdir(), "agent-compile-output-")), "claude");
  writeCanonicalPlugin(source);
  const compiler = createVendorCompiler(registry());
  const first = compiler.compilePlugin({ source, vendor: "claude", output });
  assert.equal(first.ok, true);
  const firstSnapshot = snapshot(output);
  const second = compiler.compilePlugin({ source, vendor: "claude", output });
  assert.equal(second.ok, true);
  assert.deepEqual(snapshot(output), firstSnapshot);
  assert.equal(readVendorBundle(output).ok, true);

  writeCanonicalPlugin(source, "2.0.0");
  const failingCompiler = createVendorCompiler(registry(), {
    afterPriorBackup() {
      throw new Error("injected replacement fault");
    },
  });
  const failed = failingCompiler.compilePlugin({ source, vendor: "claude", output });
  assert.equal(failed.ok, false);
  assert.ok(failed.diagnostics.some((entry) => entry.code === compilerDiagnosticCodes.compilerReplaceFailed));
  assert.deepEqual(snapshot(output), firstSnapshot);
});

test("verification regenerates in isolation and detects missing, extra, changed, and mode drift", () => {
  const source = mkdtempSync(join(tmpdir(), "agent-verify-source-"));
  const shipped = join(mkdtempSync(join(tmpdir(), "agent-verify-output-")), "codex");
  writeCanonicalPlugin(source);
  const compiler = createVendorCompiler(registry());
  assert.equal(compiler.compilePlugin({ source, vendor: "codex", output: shipped }).ok, true);
  const before = snapshot(shipped);
  assert.equal(compiler.verifyShippedPayload({ source, vendor: "codex", shipped }).ok, true);
  assert.deepEqual(snapshot(shipped), before);

  const payload = join(shipped, "payload", ".fixture-codex", "plugin.json");
  rmSync(payload);
  assert.equal(compiler.verifyShippedPayload({ source, vendor: "codex", shipped }).ok, false);
  assert.equal(compiler.compilePlugin({ source, vendor: "codex", output: shipped }).ok, true);

  const extra = join(shipped, "payload", "extra.txt");
  writeFileSync(extra, "extra\n");
  assert.equal(compiler.verifyShippedPayload({ source, vendor: "codex", shipped }).ok, false);
  rmSync(extra);

  writeFileSync(payload, "modified\n");
  const drift = compiler.verifyShippedPayload({ source, vendor: "codex", shipped });
  assert.equal(drift.ok, false);
  assert.equal(compiler.compilePlugin({ source, vendor: "codex", output: shipped }).ok, true);

  chmodSync(payload, 0o755);
  assert.equal(compiler.verifyShippedPayload({ source, vendor: "codex", shipped }).ok, false);
});
