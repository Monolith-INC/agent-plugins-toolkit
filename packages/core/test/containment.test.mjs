import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  diagnosticCodes,
  isPathInside,
  loadPluginRoot,
  resolveContained,
} from "../dist/index.js";

test("isPathInside accepts in-root paths and rejects escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-inside-"));
  mkdirSync(join(root, "skills"), { recursive: true });
  assert.equal(isPathInside(root, join(root, "plugin.json")), true);
  assert.equal(isPathInside(root, join(root, "skills", "a")), true);
  assert.equal(isPathInside(root, join(root, "..", "outside")), false);
});

test("resolveContained rejects traversal and absolute paths", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-resolve-"));
  assert.equal(resolveContained(root, "plugin.json").ok, true);
  assert.equal(resolveContained(root, "../escape").ok, false);
  assert.equal(resolveContained(root, "/tmp/escape").ok, false);
  const escaped = resolveContained(root, "../escape");
  assert.equal(escaped.ok, false);
  if (!escaped.ok) assert.equal(escaped.diagnostic.code, diagnosticCodes.pathEscape);
});

test("loadPluginRoot rejects skill symlink escapes", () => {
  const outside = mkdtempSync(join(tmpdir(), "agent-plugins-outside-skill-"));
  writeFileSync(
    join(outside, "SKILL.md"),
    "---\nname: leaked\ndescription: outside\n---\n\n# Leaked\n",
  );

  const root = mkdtempSync(join(tmpdir(), "agent-plugins-escape-skill-"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "escape-skill", version: "1.0.0" }));
  mkdirSync(join(root, "skills"), { recursive: true });
  symlinkSync(outside, join(root, "skills", "leaked"));

  const inspection = loadPluginRoot(root);
  assert.ok(inspection.diagnostics.some((d) => d.code === diagnosticCodes.pathEscape));
  assert.equal(
    inspection.skills?.some((skill) => skill.path.includes("leaked")),
    undefined,
  );
});

test("loadPluginRoot accepts in-root skill symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-inroot-skill-"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "inroot-skill", version: "1.0.0" }));
  mkdirSync(join(root, "skills", "real"), { recursive: true });
  writeFileSync(
    join(root, "skills", "real", "SKILL.md"),
    "---\nname: real\ndescription: in root\n---\n\n# Real\n",
  );
  symlinkSync(join(root, "skills", "real"), join(root, "skills", "alias"));

  const inspection = loadPluginRoot(root);
  assert.equal(inspection.diagnostics.some((d) => d.code === diagnosticCodes.pathEscape), false);
  assert.deepEqual(
    inspection.skills?.map((skill) => skill.path).sort(),
    ["skills/alias/SKILL.md", "skills/real/SKILL.md"],
  );
});

test("loadPluginRoot rejects mcp.json symlink escapes", () => {
  const outside = mkdtempSync(join(tmpdir(), "agent-plugins-outside-mcp-"));
  writeFileSync(
    join(outside, "mcp.json"),
    JSON.stringify({ leaked: { command: "node", args: ["x.js"] } }),
  );

  const root = mkdtempSync(join(tmpdir(), "agent-plugins-escape-mcp-"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "escape-mcp", version: "1.0.0" }));
  symlinkSync(join(outside, "mcp.json"), join(root, "mcp.json"));

  const inspection = loadPluginRoot(root);
  assert.ok(inspection.diagnostics.some((d) => d.code === diagnosticCodes.pathEscape));
  assert.equal(inspection.mcpServers, undefined);
});

test("resolveContained rejects missing paths under escaping symlink ancestors", () => {
  const outside = mkdtempSync(join(tmpdir(), "agent-plugins-outside-ancestor-"));
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-escape-ancestor-"));
  symlinkSync(outside, join(root, "link"));
  const escaped = resolveContained(root, "link/new-file");
  assert.equal(escaped.ok, false);
  if (!escaped.ok) assert.equal(escaped.diagnostic.code, diagnosticCodes.pathEscape);
});

test("resolveContained rejects dangling symlink escape targets", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-dangling-"));
  const missingOutside = join(tmpdir(), "agent-plugins-definitely-missing");
  symlinkSync(missingOutside, join(root, "dangling"));
  const escaped = resolveContained(root, "dangling");
  assert.equal(escaped.ok, false);
  if (!escaped.ok) assert.equal(escaped.diagnostic.code, diagnosticCodes.pathEscape);
});
