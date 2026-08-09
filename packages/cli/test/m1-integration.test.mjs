import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("validate succeeds for plugins/hello-world", () => {
  const code = withCapturedIo(() => run(["validate", join(repoRoot, "plugins/hello-world")]));
  assert.equal(code.exitCode, 0);
});

test("inspect reports hello-world portable components", () => {
  const code = withCapturedIo(() => run(["inspect", join(repoRoot, "plugins/hello-world")]));
  assert.equal(code.exitCode, 0);
  const inspection = JSON.parse(code.stdout);
  assert.equal(inspection.manifest.name, "hello-world");
  assert.deepEqual(
    inspection.skills.map((skill) => skill.path),
    ["skills/hello-world/SKILL.md"],
  );
  assert.equal(inspection.diagnostics.length, 0);
});

test("invalid fixtures cover major M1 diagnostic categories", () => {
  const cases = [
    {
      fixture: "fixtures/invalid/missing-name",
      category: /^manifest\./,
    },
    {
      fixture: "fixtures/invalid/missing-skill-md",
      category: /^skill\./,
    },
    {
      fixture: "fixtures/invalid/invalid-mcp-server",
      category: /^mcpServer/,
    },
  ];

  for (const { fixture, category } of cases) {
    const result = withCapturedIo(() => run(["validate", join(repoRoot, fixture)]));
    assert.equal(result.exitCode, 1, fixture);
    const diagnostics = JSON.parse(result.stderr);
    assert.ok(
      diagnostics.some((diagnostic) => category.test(diagnostic.code)),
      `${fixture} missing category ${category}`,
    );
  }
});

test("cli and core loader sources do not execute plugin processes", () => {
  const cliSource = readFileSync(join(repoRoot, "packages/cli/src/index.ts"), "utf8");
  const coreSource = readFileSync(join(repoRoot, "packages/core/src/index.ts"), "utf8");
  assert.equal(cliSource.includes("child_process"), false);
  assert.equal(coreSource.includes("child_process"), false);
  assert.equal(coreSource.includes("spawn("), false);
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
