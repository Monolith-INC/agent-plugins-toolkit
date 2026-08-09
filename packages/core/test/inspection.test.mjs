import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diagnosticCodes, inspectManifest, inspectPlugin, loadPluginRoot } from "../dist/index.js";

test("inspectManifest reports structured manifest diagnostics", () => {
  const inspection = inspectManifest({
    description: 42,
    extensions: [],
  });

  assert.equal(inspection.manifest, undefined);
  assert.deepEqual(
    inspection.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      path: diagnostic.path,
    })),
    [
      {
        severity: "error",
        code: diagnosticCodes.manifestNameRequired,
        path: "name",
      },
      {
        severity: "error",
        code: diagnosticCodes.manifestVersionRequired,
        path: "version",
      },
      {
        severity: "error",
        code: diagnosticCodes.manifestDescriptionInvalidType,
        path: "description",
      },
      {
        severity: "error",
        code: diagnosticCodes.manifestExtensionsInvalidType,
        path: "extensions",
      },
    ],
  );
});

test("inspectPlugin returns partial component data alongside diagnostics", () => {
  const inspection = inspectPlugin({
    name: "partial-plugin",
    version: "1.0.0",
    skills: [
      {
        name: "hello-world",
        path: "skills/hello-world/SKILL.md",
      },
      {
        name: "missing-path",
      },
      "invalid-skill",
    ],
    mcpServers: [
      {
        name: "valid-server",
        command: "node",
        args: ["server.js"],
      },
      {
        name: "missing-command",
      },
      {
        name: "invalid-args",
        command: "node",
        args: ["server.js", 42],
      },
    ],
  });

  assert.deepEqual(inspection.manifest, {
    name: "partial-plugin",
    version: "1.0.0",
  });
  assert.deepEqual(inspection.skills, [
    {
      name: "hello-world",
      path: "skills/hello-world/SKILL.md",
    },
  ]);
  assert.deepEqual(inspection.mcpServers, [
    {
      name: "valid-server",
      command: "node",
      args: ["server.js"],
    },
  ]);
  assert.deepEqual(
    inspection.diagnostics.map((diagnostic) => diagnostic.code),
    [
      diagnosticCodes.skillPathRequired,
      diagnosticCodes.skillInvalidType,
      diagnosticCodes.mcpServerCommandRequired,
      diagnosticCodes.mcpServerArgInvalidType,
    ],
  );
});

test("inspectPlugin accepts path and object map component declarations", () => {
  assert.deepEqual(
    inspectPlugin({
      name: "path-plugin",
      version: "1.0.0",
      skills: "skills",
      mcpServers: "mcp.json",
    }),
    {
      manifest: {
        name: "path-plugin",
        version: "1.0.0",
      },
      skills: [
        {
          path: "skills",
        },
      ],
      mcpServers: [
        {
          path: "mcp.json",
        },
      ],
      diagnostics: [],
    },
  );

  assert.deepEqual(
    inspectPlugin({
      name: "mapped-plugin",
      version: "1.0.0",
      mcpServers: {
        local: {
          command: "node",
          args: ["server.js"],
        },
        shared: "mcp/shared.json",
      },
    }).mcpServers,
    [
      {
        name: "local",
        command: "node",
        args: ["server.js"],
      },
      {
        name: "shared",
        path: "mcp/shared.json",
      },
    ],
  );
});

test("all stable diagnostic codes are reachable through inspection", () => {
  const inspections = [
    inspectPlugin(null),
    inspectPlugin({
      name: "",
      version: "",
      description: 42,
      extensions: [],
      skills: 42,
      mcpServers: 42,
    }),
    inspectPlugin({
      name: "invalid-components",
      version: "1.0.0",
      skills: [
        null,
        {
          name: "",
          path: "",
          description: false,
        },
      ],
      mcpServers: [
        null,
        {
          name: "",
          command: "",
          args: "invalid-args",
        },
        {
          name: "invalid-arg",
          command: "node",
          args: ["server.js", 42],
        },
      ],
    }),
  ];

  const root = mkdtempSync(join(tmpdir(), "agent-plugins-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "filesystem-codes", version: "1.0.0" }),
  );
  mkdirSync(join(root, "skills", "broken"), { recursive: true });
  const filesystemInspections = [
    loadPluginRoot(join(root, "missing-root")),
    loadPluginRoot(root),
  ];

  const emittedCodes = new Set(
    [...inspections, ...filesystemInspections].flatMap((inspection) =>
      inspection.diagnostics.map((diagnostic) => diagnostic.code),
    ),
  );

  assert.deepEqual(emittedCodes, new Set(Object.values(diagnosticCodes)));
});

test("loadPluginRoot discovers skills and mcp.json without execution", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-hello-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({
      name: "hello-world",
      version: "1.0.0",
      description: "temp",
    }),
  );
  mkdirSync(join(root, "skills", "hello-world"), { recursive: true });
  writeFileSync(
    join(root, "skills", "hello-world", "SKILL.md"),
    "---\nname: hello-world\ndescription: greeting\n---\n\n# Hello\n",
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        docs: {
          command: "node",
          args: ["server.js"],
        },
      },
    }),
  );

  const inspection = loadPluginRoot(root);
  assert.deepEqual(inspection.manifest, {
    name: "hello-world",
    version: "1.0.0",
    description: "temp",
  });
  assert.deepEqual(inspection.skills, [
    {
      name: "hello-world",
      path: "skills/hello-world/SKILL.md",
      description: "greeting",
    },
  ]);
  assert.deepEqual(inspection.mcpServers, [
    {
      name: "docs",
      command: "node",
      args: ["server.js"],
    },
  ]);
  assert.deepEqual(inspection.diagnostics, []);
});

test("loadPluginRoot keeps discovered skills when manifest JSON is a non-object", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-null-manifest-"));
  writeFileSync(join(root, "plugin.json"), "null");
  mkdirSync(join(root, "skills", "hello"), { recursive: true });
  writeFileSync(
    join(root, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: kept\n---\n\n# Hello\n",
  );

  const inspection = loadPluginRoot(root);
  assert.equal(inspection.manifest, undefined);
  assert.deepEqual(inspection.skills, [
    {
      name: "hello",
      path: "skills/hello/SKILL.md",
      description: "kept",
    },
  ]);
  assert.deepEqual(
    inspection.diagnostics.map((diagnostic) => diagnostic.code),
    [diagnosticCodes.manifestInvalidType],
  );
});

test("loadPluginRoot reports unreadable for malformed plugin.json", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-bad-json-"));
  writeFileSync(join(root, "plugin.json"), "{");
  mkdirSync(join(root, "skills", "hello"), { recursive: true });
  writeFileSync(join(root, "skills", "hello", "SKILL.md"), "---\nname: hello\n---\n");

  const inspection = loadPluginRoot(root);
  assert.deepEqual(inspection.skills, [
    {
      name: "hello",
      path: "skills/hello/SKILL.md",
    },
  ]);
  assert.equal(inspection.diagnostics[0]?.code, diagnosticCodes.manifestUnreadable);
  assert.equal(inspection.diagnostics[0]?.message, "Plugin manifest could not be parsed as JSON.");
});

test("loadPluginRoot keeps discovered skills when plugin.json is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-missing-manifest-"));
  mkdirSync(join(root, "skills", "hello"), { recursive: true });
  writeFileSync(join(root, "skills", "hello", "SKILL.md"), "---\nname: hello\n---\n");

  const inspection = loadPluginRoot(root);
  assert.deepEqual(inspection.skills, [
    {
      name: "hello",
      path: "skills/hello/SKILL.md",
    },
  ]);
  assert.equal(inspection.diagnostics[0]?.code, diagnosticCodes.manifestUnreadable);
  assert.equal(inspection.diagnostics[0]?.message, "Plugin manifest could not be read.");
});

