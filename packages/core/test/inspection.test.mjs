import assert from "node:assert/strict";
import test from "node:test";

import { diagnosticCodes, inspectManifest, inspectPlugin } from "../dist/index.js";

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

  const emittedCodes = new Set(inspections.flatMap((inspection) => inspection.diagnostics.map((diagnostic) => diagnostic.code)));

  assert.deepEqual(emittedCodes, new Set(Object.values(diagnosticCodes)));
});
