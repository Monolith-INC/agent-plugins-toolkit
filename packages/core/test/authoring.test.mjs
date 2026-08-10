import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addSkillScaffold,
  createPluginScaffold,
  diagnosticCodes,
  isValidPluginName,
  isValidSkillDirectoryName,
  loadPluginRoot,
  pluginDirectoryName,
} from "../dist/index.js";

test("isValidPluginName accepts scoped and unscoped npm-style names", () => {
  assert.equal(isValidPluginName("hello-world"), true);
  assert.equal(isValidPluginName("@acme/hello-world"), true);
  assert.equal(isValidPluginName("Hello"), false);
  assert.equal(isValidPluginName(""), false);
  assert.equal(isValidPluginName("../escape"), false);
});

test("isValidSkillDirectoryName accepts unscoped kebab segments only", () => {
  assert.equal(isValidSkillDirectoryName("demo"), true);
  assert.equal(isValidSkillDirectoryName("my-skill"), true);
  assert.equal(isValidSkillDirectoryName("@acme/demo"), false);
  assert.equal(isValidSkillDirectoryName("Demo"), false);
  assert.equal(isValidSkillDirectoryName(".."), false);
});

test("pluginDirectoryName uses the unscoped segment", () => {
  assert.equal(pluginDirectoryName("hello-world"), "hello-world");
  assert.equal(pluginDirectoryName("@acme/hello-world"), "hello-world");
});

test("createPluginScaffold writes a validateable plugin root", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-plugins-create-"));
  const destination = join(parent, "sample-plugin");

  const result = createPluginScaffold({ name: "sample-plugin", destination });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.path, destination);

  const manifest = JSON.parse(readFileSync(join(destination, "plugin.json"), "utf8"));
  assert.deepEqual(manifest, {
    name: "sample-plugin",
    version: "0.1.0",
    description: "Scaffolded by agent-plugin create.",
    schemaVersion: "1.0.0",
  });
  assert.deepEqual(readdirSync(join(destination, "skills")), []);

  const inspection = loadPluginRoot(destination);
  assert.equal(inspection.diagnostics.some((d) => d.severity === "error"), false);
});

test("createPluginScaffold refuses non-empty destinations", () => {
  const destination = mkdtempSync(join(tmpdir(), "agent-plugins-occupied-"));
  writeFileSync(join(destination, "keep.txt"), "x");

  const result = createPluginScaffold({ name: "sample-plugin", destination });
  assert.equal(result.diagnostics.length > 0, true);
  assert.equal(result.diagnostics[0]?.code, diagnosticCodes.authoringDestinationExists);
  assert.equal(existsSync(join(destination, "plugin.json")), false);
});

test("createPluginScaffold populates an empty existing directory", () => {
  const destination = mkdtempSync(join(tmpdir(), "agent-plugins-empty-"));
  const result = createPluginScaffold({ name: "sample-plugin", destination });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(existsSync(join(destination, "plugin.json")), true);
});

test("createPluginScaffold rejects invalid names before writing", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-plugins-invalid-name-"));
  const destination = join(parent, "Bad");
  const result = createPluginScaffold({ name: "Bad", destination });
  assert.equal(result.diagnostics[0]?.code, diagnosticCodes.authoringNameInvalid);
  assert.equal(existsSync(destination), false);
});

test("addSkillScaffold writes a discoverable skill", () => {
  const destination = mkdtempSync(join(tmpdir(), "agent-plugins-add-skill-"));
  assert.deepEqual(createPluginScaffold({ name: "sample-plugin", destination }).diagnostics, []);

  const result = addSkillScaffold({ skillName: "demo", pluginRoot: destination });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.path, join(destination, "skills/demo/SKILL.md"));

  const skill = readFileSync(result.path, "utf8");
  assert.match(skill, /^---\nname: demo\n/);
  assert.match(skill, /description: Use when working with the demo skill\./);

  const inspection = loadPluginRoot(destination);
  assert.deepEqual(
    inspection.skills?.map((entry) => entry.path),
    ["skills/demo/SKILL.md"],
  );
});

test("addSkillScaffold refuses missing plugin roots and duplicates", () => {
  const missing = mkdtempSync(join(tmpdir(), "agent-plugins-missing-root-"));
  const missingResult = addSkillScaffold({ skillName: "demo", pluginRoot: missing });
  assert.equal(missingResult.diagnostics[0]?.code, diagnosticCodes.authoringPluginRootInvalid);

  const destination = mkdtempSync(join(tmpdir(), "agent-plugins-dup-skill-"));
  assert.deepEqual(createPluginScaffold({ name: "sample-plugin", destination }).diagnostics, []);
  assert.deepEqual(addSkillScaffold({ skillName: "demo", pluginRoot: destination }).diagnostics, []);
  const duplicate = addSkillScaffold({ skillName: "demo", pluginRoot: destination });
  assert.equal(duplicate.diagnostics[0]?.code, diagnosticCodes.authoringSkillExists);
});

test("createPluginScaffold rejects destination paths with traversal segments", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-plugins-unsafe-"));
  mkdirSync(join(parent, "ok"));
  const result = createPluginScaffold({
    name: "sample-plugin",
    destination: join(parent, "escape"),
    rawDestination: `${parent}/ok/../escape`,
  });
  assert.equal(result.diagnostics[0]?.code, diagnosticCodes.authoringDestinationUnsafe);
});

test("authoring diagnostic codes are emitted by scaffold refusals", () => {
  const occupied = mkdtempSync(join(tmpdir(), "agent-plugins-codes-occupied-"));
  writeFileSync(join(occupied, "keep.txt"), "x");
  const missing = mkdtempSync(join(tmpdir(), "agent-plugins-codes-missing-"));
  const created = mkdtempSync(join(tmpdir(), "agent-plugins-codes-created-"));
  assert.deepEqual(createPluginScaffold({ name: "sample-plugin", destination: created }).diagnostics, []);
  assert.deepEqual(addSkillScaffold({ skillName: "demo", pluginRoot: created }).diagnostics, []);

  const emitted = new Set(
    [
      createPluginScaffold({ name: "Bad", destination: join(occupied, "bad") }),
      createPluginScaffold({ name: "sample-plugin", destination: occupied }),
      createPluginScaffold({
        name: "sample-plugin",
        destination: join(occupied, "escape"),
        rawDestination: `${occupied}/../escape`,
      }),
      addSkillScaffold({ skillName: "demo", pluginRoot: missing }),
      addSkillScaffold({ skillName: "demo", pluginRoot: created }),
      addSkillScaffold({ skillName: "Bad", pluginRoot: created }),
    ].flatMap((result) => result.diagnostics.map((diagnostic) => diagnostic.code)),
  );

  assert.equal(emitted.has(diagnosticCodes.authoringNameInvalid), true);
  assert.equal(emitted.has(diagnosticCodes.authoringDestinationExists), true);
  assert.equal(emitted.has(diagnosticCodes.authoringDestinationUnsafe), true);
  assert.equal(emitted.has(diagnosticCodes.authoringPluginRootInvalid), true);
  assert.equal(emitted.has(diagnosticCodes.authoringSkillExists), true);
});
