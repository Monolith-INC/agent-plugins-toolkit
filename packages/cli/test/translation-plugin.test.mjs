import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginRoot = join(repoRoot, "plugins/translation");

test("translation plugin validates", () => {
  const result = withCapturedIo(() => run(["validate", pluginRoot]));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true });
});

test("translation plugin inspect reports multiple skills deterministically", () => {
  const result = withCapturedIo(() => run(["inspect", pluginRoot]));
  assert.equal(result.exitCode, 0);
  const inspection = JSON.parse(result.stdout);
  const expected = JSON.parse(
    readFileSync(join(pluginRoot, "samples/expected-inspect.json"), "utf8"),
  );
  assert.equal(inspection.manifest.name, expected.manifest.name);
  assert.equal(inspection.manifest.version, expected.manifest.version);
  assert.deepEqual(
    inspection.skills.map((skill) => ({ name: skill.name, path: skill.path })),
    expected.skills,
  );
  assert.deepEqual(inspection.mcpServers, expected.mcpServers);
  assert.equal(inspection.diagnostics.length, 0);
});

test("translation remains valid without optional MCP configuration", () => {
  const result = withCapturedIo(() =>
    run(["validate", join(repoRoot, "fixtures/valid/translation-without-mcp")]),
  );
  assert.equal(result.exitCode, 0);
});

test("malformed and unsupported terminology MCP fixtures diagnose without execution", () => {
  const malformed = withCapturedIo(() =>
    run(["validate", join(repoRoot, "fixtures/invalid/translation-terminology-malformed")]),
  );
  assert.equal(malformed.exitCode, 1);
  assert.ok(
    JSON.parse(malformed.stderr).some((d) => d.code === "mcpServers.invalid_type"),
  );

  const unsupported = withCapturedIo(() =>
    run(["validate", join(repoRoot, "fixtures/invalid/translation-terminology-unsupported")]),
  );
  assert.equal(unsupported.exitCode, 1);
  assert.ok(
    JSON.parse(unsupported.stderr).some((d) => d.code === "mcpServer.transport.unsupported"),
  );
});


test("translation plugin preserves opaque extension namespace", () => {
  const result = withCapturedIo(() => run(["inspect", pluginRoot]));
  assert.equal(result.exitCode, 0);
  const inspection = JSON.parse(result.stdout);
  assert.deepEqual(inspection.manifest.extensions, {
    "com.acme.translation": {
      defaultTargetLocale: "pt-BR",
      glossaryRef: "glossaries/product.json",
      reviewRubric: ["accuracy", "fluency", "terminology"],
    },
  });
});

test("partial recovery keeps manifest and skills when MCP fails", () => {
  const result = withCapturedIo(() =>
    run(["inspect", join(repoRoot, "fixtures/invalid/translation-partial-recovery")]),
  );
  assert.equal(result.exitCode, 1);
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.manifest.name, "translation-partial-recovery");
  assert.deepEqual(inspection.manifest.extensions, {
    "com.acme.translation": { defaultTargetLocale: "pt-BR" },
  });
  assert.deepEqual(
    inspection.skills.map((skill) => skill.path),
    ["skills/translate/SKILL.md"],
  );
  assert.ok(inspection.diagnostics.some((d) => String(d.code).startsWith("mcpServer")));
});

test("malformed extensions diagnose while remaining identity can survive", () => {
  const result = withCapturedIo(() =>
    run(["inspect", join(repoRoot, "fixtures/invalid/translation-malformed-extension")]),
  );
  assert.equal(result.exitCode, 1);
  const inspection = JSON.parse(result.stdout);
  assert.ok(
    JSON.parse(result.stderr.length ? result.stderr : "[]").length >= 0 ||
      inspection.diagnostics.some((d) => d.code === "manifest.extensions.invalid_type"),
  );
  assert.ok(inspection.diagnostics.some((d) => d.code === "manifest.extensions.invalid_type"));
  assert.equal(inspection.manifest?.name, "translation-malformed-extension");
});

function withCapturedIo(action) {
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = "";
  let stderr = "";
  console.log = (value) => {
    stdout += `${value}\n`;
  };
  console.error = (value) => {
    stderr += `${value}\n`;
  };
  try {
    return { exitCode: action(), stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
