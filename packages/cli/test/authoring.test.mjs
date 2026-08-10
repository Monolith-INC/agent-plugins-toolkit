import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { diagnosticCodes } from "../../core/dist/index.js";
import { run } from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("create scaffolds a plugin that validate accepts", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-plugins-cli-create-"));
  const destination = join(parent, "sample-plugin");

  const created = withCapturedIo(() =>
    run(["create", "sample-plugin", "--path", destination]),
  );
  assert.equal(created.exitCode, 0);
  const payload = JSON.parse(created.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.name, "sample-plugin");
  assert.equal(payload.path, destination);
  assert.ok(Array.isArray(payload.nextSteps));
  assert.ok(payload.nextSteps.length > 0);

  const validated = withCapturedIo(() => run(["validate", destination]));
  assert.equal(validated.exitCode, 0);
});

test("add skill is discovered by inspect", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-plugins-cli-add-"));
  const destination = join(parent, "sample-plugin");
  assert.equal(
    withCapturedIo(() => run(["create", "sample-plugin", "--path", destination])).exitCode,
    0,
  );

  const added = withCapturedIo(() => run(["add", "skill", "demo", "--path", destination]));
  assert.equal(added.exitCode, 0);
  const payload = JSON.parse(added.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.name, "demo");
  assert.equal(payload.path, join(destination, "skills/demo/SKILL.md"));

  const inspected = withCapturedIo(() => run(["inspect", destination]));
  assert.equal(inspected.exitCode, 0);
  const inspection = JSON.parse(inspected.stdout);
  assert.deepEqual(
    inspection.skills.map((skill) => skill.path),
    ["skills/demo/SKILL.md"],
  );
});

test("create refuses invalid names and occupied destinations", () => {
  const invalid = withCapturedIo(() => run(["create", "BadName"]));
  assert.equal(invalid.exitCode, 1);
  assert.equal(JSON.parse(invalid.stderr)[0].code, diagnosticCodes.authoringNameInvalid);

  const occupied = mkdtempSync(join(tmpdir(), "agent-plugins-cli-occupied-"));
  writeFileSync(join(occupied, "keep.txt"), "x");
  const refused = withCapturedIo(() => run(["create", "sample-plugin", "--path", occupied]));
  assert.equal(refused.exitCode, 1);
  assert.equal(JSON.parse(refused.stderr)[0].code, diagnosticCodes.authoringDestinationExists);
});

test("add skill refuses missing plugin roots and duplicates", () => {
  const missing = mkdtempSync(join(tmpdir(), "agent-plugins-cli-missing-"));
  const missingResult = withCapturedIo(() => run(["add", "skill", "demo", "--path", missing]));
  assert.equal(missingResult.exitCode, 1);
  assert.equal(
    JSON.parse(missingResult.stderr)[0].code,
    diagnosticCodes.authoringPluginRootInvalid,
  );

  const destination = join(mkdtempSync(join(tmpdir(), "agent-plugins-cli-dup-")), "plugin");
  assert.equal(
    withCapturedIo(() => run(["create", "sample-plugin", "--path", destination])).exitCode,
    0,
  );
  assert.equal(
    withCapturedIo(() => run(["add", "skill", "demo", "--path", destination])).exitCode,
    0,
  );
  const duplicate = withCapturedIo(() => run(["add", "skill", "demo", "--path", destination]));
  assert.equal(duplicate.exitCode, 1);
  assert.equal(JSON.parse(duplicate.stderr)[0].code, diagnosticCodes.authoringSkillExists);
});

test("create --help and add skill --help print usage", () => {
  const createHelp = withCapturedIo(() => run(["create", "--help"]));
  assert.equal(createHelp.exitCode, 0);
  assert.match(createHelp.stdout, /create/);

  const addHelp = withCapturedIo(() => run(["add", "skill", "--help"]));
  assert.equal(addHelp.exitCode, 0);
  assert.match(addHelp.stdout, /add skill/);
});

test("create defaults destination under cwd using unscoped name", () => {
  const cwd = mkdtempSync(join(tmpdir(), "agent-plugins-cli-cwd-"));
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    const created = withCapturedIo(() => run(["create", "@acme/sample-plugin"]));
    assert.equal(created.exitCode, 0);
    const payload = JSON.parse(created.stdout);
    assert.equal(payload.name, "@acme/sample-plugin");
    assert.equal(payload.path, join(cwd, "sample-plugin"));
    assert.equal(existsSync(join(cwd, "sample-plugin/plugin.json")), true);
  } finally {
    process.chdir(previous);
  }
});

test("create refuses literal traversal in --path", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-plugins-cli-traversal-"));
  mkdirSync(join(parent, "ok"));
  const raw = withCapturedIo(() =>
    run(["create", "sample-plugin", "--path", `${parent}/ok/../escape`]),
  );
  assert.equal(raw.exitCode, 1);
  assert.equal(JSON.parse(raw.stderr)[0].code, diagnosticCodes.authoringDestinationUnsafe);
});

test("authoring CLI sources do not execute plugin processes", () => {
  const cliSource = readFileSync(join(repoRoot, "packages/cli/src/index.ts"), "utf8");
  assert.equal(cliSource.includes("child_process"), false);
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
