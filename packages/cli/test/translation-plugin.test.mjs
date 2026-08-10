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
  assert.equal(inspection.diagnostics.length, 0);
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
