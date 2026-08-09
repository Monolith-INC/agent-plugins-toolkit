import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("validate succeeds for plugins/hello-world", () => {
  const code = withCapturedIo(() => run(["validate", join(repoRoot, "plugins/hello-world")]));
  assert.equal(code.exitCode, 0);
  assert.deepEqual(JSON.parse(code.stdout), { ok: true });
});

test("validate succeeds for fixtures/valid/hello-world", () => {
  const code = withCapturedIo(() => run(["validate", join(repoRoot, "fixtures/valid/hello-world")]));
  assert.equal(code.exitCode, 0);
  assert.deepEqual(JSON.parse(code.stdout), { ok: true });
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

test("inspect reports MCP command metadata without spawning a process", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-mcp-inspect-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "mcp-inspect", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      docs: {
        command: "node",
        args: ["server.js"],
      },
    }),
  );

  const result = withCapturedIo(() => run(["inspect", root]));
  assert.equal(result.exitCode, 0);
  const inspection = JSON.parse(result.stdout);
  assert.deepEqual(inspection.mcpServers, [
    {
      name: "docs",
      command: "node",
      args: ["server.js"],
    },
  ]);
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
    {
      fixture: "fixtures/invalid/unsupported-schema-version",
      category: /^manifest\.schemaVersion/,
    },
    {
      fixture: "fixtures/invalid/unknown-field",
      category: /^manifest\.unknown_field$/,
    },
    {
      fixture: "fixtures/invalid/invalid-plugin-name",
      category: /^manifest\.name/,
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

test("invalid MCP fixture omits empty mcpServers list", () => {
  const result = withCapturedIo(() => run(["inspect", join(repoRoot, "fixtures/invalid/invalid-mcp-server")]));
  assert.equal(result.exitCode, 1);
  const inspection = JSON.parse(result.stdout);
  assert.equal(Object.hasOwn(inspection, "mcpServers"), false);
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
