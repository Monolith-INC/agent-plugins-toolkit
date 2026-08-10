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
      transport: "stdio",
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
          transport: "config-path",
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
        transport: "stdio",
        name: "local",
        command: "node",
        args: ["server.js"],
      },
      {
        transport: "config-path",
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
          cwd: 42,
        },
        {
          name: "invalid-arg",
          command: "node",
          args: ["server.js", 42],
        },
        {
          name: "bad-transport",
          type: "websocket",
        },
        {
          name: "url-without-transport",
          url: "https://example.com/mcp",
        },
        {
          name: "sse-missing-url",
          transport: "sse",
        },
        {
          name: "path-missing",
          transport: "config-path",
        },
      ],
    }),
    inspectManifest({
      name: "Invalid_Name",
      version: "1.0.0",
      schemaVersion: "2.0.0",
      hooks: {},
    }),
    inspectManifest({
      name: "typed-schema",
      version: "1.0.0",
      schemaVersion: 1,
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

  assert.deepEqual(
    emittedCodes,
    new Set(
      Object.values(diagnosticCodes).filter(
        (code) => !String(code).startsWith("path.") && !String(code).startsWith("authoring."),
      ),
    ),
  );
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
      transport: "stdio",
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

test("loadPluginRoot discovers only immediate skills deterministically and ignores nested skills", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-skill-discovery-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "skill-discovery", version: "1.0.0" }),
  );
  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(join(root, "skills", "README.md"), "ignored file\n");
  for (const [name, description] of [
    ["zeta", "third"],
    ["alpha", "first"],
    ["beta", "second"],
  ]) {
    mkdirSync(join(root, "skills", name), { recursive: true });
    writeFileSync(
      join(root, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    );
  }
  mkdirSync(join(root, "skills", "alpha", "nested-ignored"), { recursive: true });
  writeFileSync(
    join(root, "skills", "alpha", "nested-ignored", "SKILL.md"),
    "---\nname: nested-ignored\ndescription: must not be discovered\n---\n\n# Nested\n",
  );

  const inspection = loadPluginRoot(root);
  assert.deepEqual(
    inspection.skills.map((skill) => skill.path),
    ["skills/alpha/SKILL.md", "skills/beta/SKILL.md", "skills/zeta/SKILL.md"],
  );
  assert.equal(
    inspection.skills.some((skill) => skill.name === "nested-ignored"),
    false,
  );
  assert.deepEqual(inspection.diagnostics, []);
});

test("loadPluginRoot reports missing SKILL.md without executing skill content", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-missing-skill-md-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "missing-skill-md", version: "1.0.0" }),
  );
  mkdirSync(join(root, "skills", "broken"), { recursive: true });
  writeFileSync(join(root, "skills", "broken", "run.sh"), "#!/bin/sh\necho should-not-run\n");

  const inspection = loadPluginRoot(root);
  assert.equal(Object.hasOwn(inspection, "skills"), false);
  assert.deepEqual(inspection.diagnostics, [
    {
      severity: "error",
      code: diagnosticCodes.skillMissingSkillMd,
      message: "Skill directory must contain SKILL.md.",
      path: "skills/broken/SKILL.md",
    },
  ]);
});

test("inspectManifest rejects unsupported schema, unknown fields, and invalid names", () => {
  const unsupported = inspectManifest({
    name: "good-name",
    version: "1.0.0",
    schemaVersion: "9.9.9",
  });
  assert.equal(unsupported.manifest, undefined);
  assert.ok(
    unsupported.diagnostics.some((diagnostic) => diagnostic.code === diagnosticCodes.manifestSchemaVersionUnsupported),
  );

  const unknown = inspectManifest({
    name: "good-name",
    version: "1.0.0",
    hooks: true,
  });
  assert.equal(unknown.manifest, undefined);
  assert.ok(unknown.diagnostics.some((diagnostic) => diagnostic.code === diagnosticCodes.manifestUnknownField));

  const invalidName = inspectManifest({
    name: "Bad_Name",
    version: "1.0.0",
  });
  assert.equal(invalidName.manifest, undefined);
  assert.ok(invalidName.diagnostics.some((diagnostic) => diagnostic.code === diagnosticCodes.manifestNameInvalid));

  const preserved = inspectManifest({
    name: "good-name",
    version: "1.0.0",
    schemaVersion: "1.0.0",
    extensions: { "com.example": { flag: true } },
  });
  assert.deepEqual(preserved.manifest, {
    name: "good-name",
    version: "1.0.0",
    schemaVersion: "1.0.0",
    extensions: { "com.example": { flag: true } },
  });
  assert.deepEqual(preserved.diagnostics, []);
});


test("loadPluginRoot models MCP transports and explicit placeholders", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-mcp-transports-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "mcp-transports", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
          command: "node",
          args: ["${PLUGIN_ROOT}/server.js"],
          cwd: "${PLUGIN_DATA}/runtime",
        },
        docs: {
          type: "streamable-http",
          url: "https://example.com/${PLUGIN_ROOT}/mcp",
        },
        events: {
          transport: "sse",
          url: "https://example.com/events",
        },
      },
    }),
  );

  const inspection = loadPluginRoot(root);
  assert.deepEqual(inspection.mcpServers, [
    {
      transport: "stdio",
      name: "local",
      command: "node",
      args: ["${PLUGIN_ROOT}/server.js"],
      cwd: "${PLUGIN_DATA}/runtime",
      placeholders: ["PLUGIN_DATA", "PLUGIN_ROOT"],
    },
    {
      transport: "streamable-http",
      name: "docs",
      url: "https://example.com/${PLUGIN_ROOT}/mcp",
      placeholders: ["PLUGIN_ROOT"],
    },
    {
      transport: "sse",
      name: "events",
      url: "https://example.com/events",
    },
  ]);
  assert.deepEqual(inspection.diagnostics, []);
});

test("missing mcp.json remains valid", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-no-mcp-"));
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "no-mcp", version: "1.0.0" }),
  );
  const inspection = loadPluginRoot(root);
  assert.equal(Object.hasOwn(inspection, "mcpServers"), false);
  assert.deepEqual(inspection.diagnostics, []);
});

test("MCP inference rejects ambiguous command+url and invalid cwd drops the server", () => {
  const ambiguous = inspectPlugin({
    name: "ambiguous-mcp",
    version: "1.0.0",
    mcpServers: [
      {
        name: "both",
        command: "node",
        url: "https://example.com",
      },
      {
        name: "conflict",
        type: "stdio",
        transport: "sse",
        command: "node",
      },
      {
        name: "bad-cwd",
        command: "node",
        cwd: 42,
      },
    ],
  });
  assert.equal(Object.hasOwn(ambiguous, "mcpServers"), false);
  assert.deepEqual(
    ambiguous.diagnostics.map((diagnostic) => diagnostic.code),
    [
      diagnosticCodes.mcpServerTransportRequired,
      diagnosticCodes.mcpServerTransportUnsupported,
      diagnosticCodes.mcpServerCwdInvalidType,
    ],
  );
});
