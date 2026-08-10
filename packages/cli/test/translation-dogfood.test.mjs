import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginRoot = join(repoRoot, "plugins/translation");

test("dogfood end-to-end: validate, inspect, multi-skill, mcp, extensions", () => {
  const validate = withCapturedIo(() => run(["validate", pluginRoot]));
  assert.equal(validate.exitCode, 0);

  const inspect = withCapturedIo(() => run(["inspect", pluginRoot]));
  assert.equal(inspect.exitCode, 0);
  const inspection = JSON.parse(inspect.stdout);
  const expected = JSON.parse(
    readFileSync(join(pluginRoot, "samples/expected-inspect.json"), "utf8"),
  );

  assert.deepEqual(
    inspection.skills.map((skill) => ({ name: skill.name, path: skill.path })),
    expected.skills,
  );
  assert.deepEqual(inspection.mcpServers, expected.mcpServers);
  assert.deepEqual(inspection.manifest.extensions, expected.manifest.extensions);
  assert.equal(inspection.diagnostics.length, 0);
});

test("dogfood docs distinguish portable authoring from vendor install work", () => {
  const docs = readFileSync(join(repoRoot, "docs/translation-plugin-dogfood.md"), "utf8");
  assert.match(docs, /No vendor payload compilation/);
  assert.match(docs, /No `agent-plugin install`/);
  assert.match(docs, /Non-execution/);
});

test("dogfood recovery fixtures keep valid portable pieces visible", () => {
  const result = withCapturedIo(() =>
    run(["inspect", join(repoRoot, "fixtures/invalid/translation-partial-recovery")]),
  );
  assert.equal(result.exitCode, 1);
  const inspection = JSON.parse(result.stdout);
  assert.ok(inspection.manifest);
  assert.ok(inspection.skills?.length > 0);
  assert.ok(inspection.diagnostics.some((d) => String(d.code).startsWith("mcpServer")));
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
