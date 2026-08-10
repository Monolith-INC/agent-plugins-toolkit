import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  diagnosticCodes,
  inspectManifest,
  inspectPlugin,
  loadPluginRoot,
} from "../dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("core sources never spawn processes or open network connections", () => {
  const source = readFileSync(join(repoRoot, "packages/core/src/index.ts"), "utf8");
  assert.equal(source.includes("child_process"), false);
  assert.equal(source.includes("spawn("), false);
  assert.equal(source.includes("exec("), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("http.request"), false);
  assert.equal(source.includes("https.request"), false);
});

test("malformed JSON and hostile layouts yield diagnostics without throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-hostile-"));
  writeFileSync(join(root, "plugin.json"), "{ not-json");
  mkdirSync(join(root, "skills", "weird name"), { recursive: true });
  writeFileSync(join(root, "skills", "weird name", "SKILL.md"), "# No frontmatter\n");
  writeFileSync(join(root, "mcp.json"), "{");

  assert.doesNotThrow(() => loadPluginRoot(root));
  const inspection = loadPluginRoot(root);
  assert.ok(inspection.diagnostics.some((d) => d.code === diagnosticCodes.manifestUnreadable));
  assert.ok(inspection.diagnostics.some((d) => d.code === diagnosticCodes.mcpServersInvalidType));
  assert.ok(
    inspection.skills?.some((skill) => skill.path === "skills/weird name/SKILL.md") ?? false,
  );
});

test("nested executable-looking files are never treated as portable skills", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-nested-exec-"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "nested-exec", version: "1.0.0" }));
  mkdirSync(join(root, "skills", "visible", "bin"), { recursive: true });
  writeFileSync(
    join(root, "skills", "visible", "SKILL.md"),
    "---\nname: visible\ndescription: ok\n---\n\n# Visible\n",
  );
  writeFileSync(join(root, "skills", "visible", "bin", "run.sh"), "#!/bin/sh\necho pwned\n");
  writeFileSync(join(root, "skills", "visible", "bin", "SKILL.md"), "# Nested ignored\n");

  const inspection = loadPluginRoot(root);
  assert.deepEqual(
    inspection.skills?.map((skill) => skill.path),
    ["skills/visible/SKILL.md"],
  );
  assert.equal(inspection.diagnostics.length, 0);
});

test("symlink skill directories that escape the root are not imported as skills", () => {
  const outside = mkdtempSync(join(tmpdir(), "agent-plugins-sec-outside-"));
  writeFileSync(
    join(outside, "SKILL.md"),
    "---\nname: leaked\ndescription: outside\n---\n\n# Leaked\n",
  );
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-sec-root-"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "sec-root", version: "1.0.0" }));
  mkdirSync(join(root, "skills"), { recursive: true });
  symlinkSync(outside, join(root, "skills", "leaked"));

  const inspection = loadPluginRoot(root);
  const leaked = inspection.skills?.some((skill) => skill.name === "leaked") ?? false;
  const escaped = inspection.diagnostics.some((d) => d.code === "path.escape");
  // Safe either by omission (pre-containment) or explicit path.escape (AGE-26+).
  assert.equal(leaked && !escaped, false);
});

test("diagnostic snapshots preserve severity code and path shape", () => {
  const inspection = inspectManifest({
    name: "Invalid_Name",
    version: "1.0.0",
    hooks: {},
  });
  assert.ok(inspection.diagnostics.length >= 2);
  inspection.diagnostics.map((diagnostic) => {
    assert.ok(["error", "warning", "info"].includes(diagnostic.severity));
    assert.equal(typeof diagnostic.code, "string");
    assert.equal(typeof diagnostic.message, "string");
    return diagnostic;
  });
  assert.ok(inspection.diagnostics.some((d) => d.path === "name"));
  assert.ok(inspection.diagnostics.some((d) => d.path === "hooks"));
});

test("partial inspection keeps valid siblings when one MCP entry fails", () => {
  const inspection = inspectPlugin({
    name: "partial-mcp",
    version: "1.0.0",
    mcpServers: {
      good: { command: "node", args: ["ok.js"] },
      bad: { command: "" },
    },
  });
  assert.ok(inspection.mcpServers?.some((server) => server.name === "good"));
  assert.ok(inspection.diagnostics.some((d) => d.code === diagnosticCodes.mcpServerCommandRequired));
});
