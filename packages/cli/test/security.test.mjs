import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("cli sources never spawn processes", () => {
  const source = readFileSync(join(repoRoot, "packages/cli/src/index.ts"), "utf8");
  assert.equal(source.includes("child_process"), false);
  assert.equal(source.includes("spawn("), false);
  assert.equal(source.includes("exec("), false);
  assert.equal(source.includes("fetch("), false);
});

test("validate against fixture corpus covers major diagnostic families", () => {
  const cases = [
    ["fixtures/invalid/missing-name", /^manifest\./],
    ["fixtures/invalid/missing-skill-md", /^skill\./],
    ["fixtures/invalid/invalid-mcp-server", /^mcpServer/],
    ["fixtures/invalid/unsupported-schema-version", /^manifest\.schemaVersion/],
    ["fixtures/invalid/unknown-field", /^manifest\.unknown_field$/],
    ["fixtures/invalid/invalid-plugin-name", /^manifest\.name/],
  ];

  cases.map(([fixture, category]) => {
    const result = withCapturedIo(() => run(["validate", join(repoRoot, fixture)]));
    assert.equal(result.exitCode, 1, fixture);
    const diagnostics = JSON.parse(result.stderr);
    assert.ok(
      diagnostics.some((diagnostic) => category.test(diagnostic.code)),
      `${fixture} missing ${category}`,
    );
    return fixture;
  });
});

test("inspect does not execute MCP command metadata from temp plugins", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-cli-sec-"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "cli-sec", version: "1.0.0" }));
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      boom: { command: "node", args: ["-e", "process.exit(42)"] },
    }),
  );
  const result = withCapturedIo(() => run(["inspect", root]));
  assert.equal(result.exitCode, 0);
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.mcpServers[0].command, "node");
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
