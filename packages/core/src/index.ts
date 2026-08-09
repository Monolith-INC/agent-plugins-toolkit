import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type DiagnosticSeverity = "error" | "warning" | "info";

export const diagnosticCodes = {
  manifestInvalidType: "manifest.invalid_type",
  manifestNameRequired: "manifest.name.required",
  manifestVersionRequired: "manifest.version.required",
  manifestDescriptionInvalidType: "manifest.description.invalid_type",
  manifestExtensionsInvalidType: "manifest.extensions.invalid_type",
  skillsInvalidType: "skills.invalid_type",
  skillInvalidType: "skill.invalid_type",
  skillNameRequired: "skill.name.required",
  skillPathRequired: "skill.path.required",
  skillDescriptionInvalidType: "skill.description.invalid_type",
  mcpServersInvalidType: "mcpServers.invalid_type",
  mcpServerInvalidType: "mcpServer.invalid_type",
  mcpServerNameRequired: "mcpServer.name.required",
  mcpServerCommandRequired: "mcpServer.command.required",
  mcpServerArgsInvalidType: "mcpServer.args.invalid_type",
  mcpServerArgInvalidType: "mcpServer.args.item.invalid_type",
  manifestUnreadable: "manifest.unreadable",
  skillMissingSkillMd: "skill.missing_skill_md",
} as const;

export type DiagnosticCode = (typeof diagnosticCodes)[keyof typeof diagnosticCodes] | (string & {});

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly path?: string;
}

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly extensions?: Record<string, unknown>;
}

export interface PluginSkill {
  readonly name?: string;
  readonly path: string;
  readonly description?: string;
}

export interface PluginMcpServer {
  readonly name?: string;
  readonly path?: string;
  readonly command?: string;
  readonly args?: readonly string[];
}

export interface PluginInspection {
  readonly manifest?: PluginManifest;
  readonly skills?: readonly PluginSkill[];
  readonly mcpServers?: readonly PluginMcpServer[];
  readonly diagnostics: readonly Diagnostic[];
}

type ReadResult<T> = {
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
};

export function createDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return diagnostic;
}

export function inspectManifest(value: unknown): PluginInspection {
  if (!isRecord(value)) {
    return {
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: diagnosticCodes.manifestInvalidType,
          message: "Plugin manifest must be a JSON object.",
        }),
      ],
    };
  }

  const manifest = readManifest(value);
  return {
    ...(manifest.value === undefined ? {} : { manifest: manifest.value }),
    diagnostics: manifest.diagnostics,
  };
}

export function inspectPlugin(value: unknown): PluginInspection {
  if (!isRecord(value)) {
    return inspectManifest(value);
  }

  const manifest = readManifest(value);
  const skills = readSkills(value["skills"]);
  const mcpServers = readMcpServers(value["mcpServers"]);

  return {
    ...(manifest.value === undefined ? {} : { manifest: manifest.value }),
    ...(skills.value === undefined ? {} : { skills: skills.value }),
    ...(mcpServers.value === undefined ? {} : { mcpServers: mcpServers.value }),
    diagnostics: [...manifest.diagnostics, ...skills.diagnostics, ...mcpServers.diagnostics],
  };
}

function readManifest(value: Record<string, unknown>): ReadResult<PluginManifest> {
  const name = readRequiredString(value, "name", diagnosticCodes.manifestNameRequired);
  const version = readRequiredString(value, "version", diagnosticCodes.manifestVersionRequired);
  const description = readOptionalString(value, "description", diagnosticCodes.manifestDescriptionInvalidType);
  const extensions = readOptionalRecord(value, "extensions", diagnosticCodes.manifestExtensionsInvalidType);
  const diagnostics = [
    ...name.diagnostics,
    ...version.diagnostics,
    ...description.diagnostics,
    ...extensions.diagnostics,
  ];

  return name.value === undefined || version.value === undefined
    ? { diagnostics }
    : {
        value: {
          name: name.value,
          version: version.value,
          ...(description.value === undefined ? {} : { description: description.value }),
          ...(extensions.value === undefined ? {} : { extensions: extensions.value }),
        },
        diagnostics,
      };
}

function readSkills(value: unknown): ReadResult<readonly PluginSkill[]> {
  if (value === undefined) return { diagnostics: [] };
  if (typeof value === "string" && value.length > 0) {
    return { value: [{ path: value }], diagnostics: [] };
  }
  if (!Array.isArray(value)) {
    return {
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: diagnosticCodes.skillsInvalidType,
          message: 'Plugin field "skills" must be a path string or an array when present.',
          path: "skills",
        }),
      ],
    };
  }

  return value.reduce<ReadResult<readonly PluginSkill[]>>(
    (acc, entry, index) => {
      const path = `skills[${index}]`;
      if (!isRecord(entry)) {
        return {
          value: acc.value ?? [],
          diagnostics: [
            ...acc.diagnostics,
            createDiagnostic({
              severity: "error",
              code: diagnosticCodes.skillInvalidType,
              message: "Skill entry must be an object.",
              path,
            }),
          ],
        };
      }

      const name = readRequiredString(entry, "name", diagnosticCodes.skillNameRequired, path);
      const skillPath = readRequiredString(entry, "path", diagnosticCodes.skillPathRequired, path);
      const description = readOptionalString(
        entry,
        "description",
        diagnosticCodes.skillDescriptionInvalidType,
        path,
      );
      const diagnostics = [...acc.diagnostics, ...name.diagnostics, ...skillPath.diagnostics, ...description.diagnostics];

      return name.value === undefined || skillPath.value === undefined
        ? { value: acc.value ?? [], diagnostics }
        : {
            value: [
              ...(acc.value ?? []),
              {
                name: name.value,
                path: skillPath.value,
                ...(description.value === undefined ? {} : { description: description.value }),
              },
            ],
            diagnostics,
          };
    },
    { value: [], diagnostics: [] },
  );
}

function readMcpServers(value: unknown): ReadResult<readonly PluginMcpServer[]> {
  if (value === undefined) return { diagnostics: [] };
  if (typeof value === "string" && value.length > 0) {
    return { value: [{ path: value }], diagnostics: [] };
  }
  if (isRecord(value)) {
    return readMcpServerMap(value);
  }
  if (!Array.isArray(value)) {
    return {
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: diagnosticCodes.mcpServersInvalidType,
          message: 'Plugin field "mcpServers" must be a path string, object map, or array when present.',
          path: "mcpServers",
        }),
      ],
    };
  }

  return value.reduce<ReadResult<readonly PluginMcpServer[]>>(
    (acc, entry, index) => {
      const path = `mcpServers[${index}]`;
      if (!isRecord(entry)) {
        return {
          value: acc.value ?? [],
          diagnostics: [
            ...acc.diagnostics,
            createDiagnostic({
              severity: "error",
              code: diagnosticCodes.mcpServerInvalidType,
              message: "MCP server entry must be an object.",
              path,
            }),
          ],
        };
      }

      const name = readRequiredString(entry, "name", diagnosticCodes.mcpServerNameRequired, path);
      const command = readRequiredString(entry, "command", diagnosticCodes.mcpServerCommandRequired, path);
      const args = readOptionalStringArray(entry, "args", path);
      const diagnostics = [...acc.diagnostics, ...name.diagnostics, ...command.diagnostics, ...args.diagnostics];

      return name.value === undefined || command.value === undefined || !args.isValid
        ? { value: acc.value ?? [], diagnostics }
        : {
            value: [
              ...(acc.value ?? []),
              {
                name: name.value,
                command: command.value,
                ...(args.value === undefined ? {} : { args: args.value }),
              },
            ],
            diagnostics,
          };
    },
    { value: [], diagnostics: [] },
  );
}

function readMcpServerMap(value: Record<string, unknown>): ReadResult<readonly PluginMcpServer[]> {
  return Object.entries(value).reduce<ReadResult<readonly PluginMcpServer[]>>(
    (acc, [name, entry]) => {
      const path = `mcpServers.${name}`;
      if (typeof entry === "string" && entry.length > 0) {
        return {
          value: [...(acc.value ?? []), { name, path: entry }],
          diagnostics: acc.diagnostics,
        };
      }

      if (!isRecord(entry)) {
        return {
          value: acc.value ?? [],
          diagnostics: [
            ...acc.diagnostics,
            createDiagnostic({
              severity: "error",
              code: diagnosticCodes.mcpServerInvalidType,
              message: "MCP server entry must be an object or path string.",
              path,
            }),
          ],
        };
      }

      const command = readRequiredString(entry, "command", diagnosticCodes.mcpServerCommandRequired, path);
      const args = readOptionalStringArray(entry, "args", path);
      const diagnostics = [...acc.diagnostics, ...command.diagnostics, ...args.diagnostics];

      return command.value === undefined || !args.isValid
        ? { value: acc.value ?? [], diagnostics }
        : {
            value: [
              ...(acc.value ?? []),
              {
                name,
                command: command.value,
                ...(args.value === undefined ? {} : { args: args.value }),
              },
            ],
            diagnostics,
          };
    },
    { value: [], diagnostics: [] },
  );
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  code: DiagnosticCode,
  parentPath?: string,
): ReadResult<string> {
  const entry = value[key];
  return typeof entry === "string" && entry.length > 0
    ? { value: entry, diagnostics: [] }
    : {
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code,
            message: `Field "${key}" must be a non-empty string.`,
            path: formatPath(parentPath, key),
          }),
        ],
      };
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  code: DiagnosticCode,
  parentPath?: string,
): ReadResult<string> {
  const entry = value[key];
  if (entry === undefined) return { diagnostics: [] };
  return typeof entry === "string"
    ? { value: entry, diagnostics: [] }
    : {
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code,
            message: `Field "${key}" must be a string when present.`,
            path: formatPath(parentPath, key),
          }),
        ],
      };
}

function readOptionalRecord(
  value: Record<string, unknown>,
  key: string,
  code: DiagnosticCode,
  parentPath?: string,
): ReadResult<Record<string, unknown>> {
  const entry = value[key];
  if (entry === undefined) return { diagnostics: [] };
  return isRecord(entry)
    ? { value: entry, diagnostics: [] }
    : {
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code,
            message: `Field "${key}" must be an object when present.`,
            path: formatPath(parentPath, key),
          }),
        ],
      };
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  key: string,
  parentPath?: string,
): { readonly isValid: boolean; readonly value?: readonly string[]; readonly diagnostics: readonly Diagnostic[] } {
  const entry = value[key];
  if (entry === undefined) return { isValid: true, diagnostics: [] };
  const path = formatPath(parentPath, key);

  if (!Array.isArray(entry)) {
    return {
      isValid: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: diagnosticCodes.mcpServerArgsInvalidType,
          message: `Field "${key}" must be an array of strings when present.`,
          path,
        }),
      ],
    };
  }

  const invalidIndex = entry.findIndex((item) => typeof item !== "string");
  return invalidIndex === -1
    ? { isValid: true, value: entry, diagnostics: [] }
    : {
        isValid: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.mcpServerArgInvalidType,
            message: `Field "${key}" must contain only strings.`,
            path: `${path}[${invalidIndex}]`,
          }),
        ],
      };
}

function formatPath(parentPath: string | undefined, key: string): string {
  return parentPath === undefined ? key : `${parentPath}.${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type JsonRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly value: unknown };

export function loadPluginRoot(root: string): PluginInspection {
  const pluginRoot = resolve(root);
  return foldManifestRead(readJson(join(pluginRoot, "plugin.json")), pluginRoot);
}

function foldManifestRead(manifestRead: JsonRead, pluginRoot: string): PluginInspection {
  switch (manifestRead.kind) {
    case "missing":
      return {
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.manifestUnreadable,
            message: "Plugin manifest could not be read.",
            path: "plugin.json",
          }),
        ],
      };
    case "invalid":
      return {
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.manifestUnreadable,
            message: "Plugin manifest could not be parsed as JSON.",
            path: "plugin.json",
          }),
        ],
      };
    case "ok":
      return inspectLoadedPlugin(pluginRoot, manifestRead.value);
  }
}

function inspectLoadedPlugin(pluginRoot: string, manifestValue: unknown): PluginInspection {
  const skillDiscovery = discoverSkills(pluginRoot);
  const mcpDiscovery = discoverMcpServers(pluginRoot);

  if (!isRecord(manifestValue)) {
    const manifestInspection = inspectManifest(manifestValue);
    const skills = readSkills(skillDiscovery.skills.length === 0 ? undefined : skillDiscovery.skills);
    const mcpServers = readMcpServers(mcpDiscovery.mcpServers);

    return {
      ...manifestInspection,
      ...(skills.value === undefined ? {} : { skills: skills.value }),
      ...(mcpServers.value === undefined ? {} : { mcpServers: mcpServers.value }),
      diagnostics: [
        ...skillDiscovery.diagnostics,
        ...mcpDiscovery.diagnostics,
        ...manifestInspection.diagnostics,
        ...skills.diagnostics,
        ...mcpServers.diagnostics,
      ],
    };
  }

  const inspection = inspectPlugin(
    buildDeclaration(manifestValue, skillDiscovery.skills, mcpDiscovery.mcpServers),
  );

  return {
    ...inspection,
    diagnostics: [...skillDiscovery.diagnostics, ...mcpDiscovery.diagnostics, ...inspection.diagnostics],
  };
}

function buildDeclaration(
  manifestValue: Record<string, unknown>,
  skills: readonly Record<string, unknown>[],
  mcpServers: unknown,
): Record<string, unknown> {
  return {
    ...manifestValue,
    ...(skills.length === 0 ? {} : { skills }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
  };
}

function discoverSkills(pluginRoot: string): {
  readonly skills: readonly Record<string, unknown>[];
  readonly diagnostics: readonly Diagnostic[];
} {
  return listDirectories(join(pluginRoot, "skills")).reduce<{
    readonly skills: readonly Record<string, unknown>[];
    readonly diagnostics: readonly Diagnostic[];
  }>(
    (acc, entry) => {
      const relativeSkillPath = `skills/${entry}/SKILL.md`;
      const skillFile = readText(join(pluginRoot, relativeSkillPath));

      return skillFile === undefined
        ? {
            skills: acc.skills,
            diagnostics: [
              ...acc.diagnostics,
              createDiagnostic({
                severity: "error",
                code: diagnosticCodes.skillMissingSkillMd,
                message: "Skill directory must contain SKILL.md.",
                path: relativeSkillPath,
              }),
            ],
          }
        : {
            skills: [...acc.skills, skillDeclaration(entry, relativeSkillPath, skillFile)],
            diagnostics: acc.diagnostics,
          };
    },
    { skills: [], diagnostics: [] },
  );
}

function skillDeclaration(entry: string, relativeSkillPath: string, content: string): Record<string, unknown> {
  const frontmatter = parseFrontmatter(content);
  const name = frontmatter["name"];
  const description = frontmatter["description"];

  return {
    path: relativeSkillPath,
    name: typeof name === "string" && name.length > 0 ? name : entry,
    ...(typeof description === "string" ? { description } : {}),
  };
}

function discoverMcpServers(pluginRoot: string): {
  readonly mcpServers: unknown;
  readonly diagnostics: readonly Diagnostic[];
} {
  const mcpRead = readJson(join(pluginRoot, "mcp.json"));
  switch (mcpRead.kind) {
    case "missing":
      return { mcpServers: undefined, diagnostics: [] };
    case "invalid":
      return {
        mcpServers: undefined,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.mcpServersInvalidType,
            message: "MCP configuration must be valid JSON.",
            path: "mcp.json",
          }),
        ],
      };
    case "ok":
      return { mcpServers: normalizeMcpConfiguration(mcpRead.value), diagnostics: [] };
  }
}

function normalizeMcpConfiguration(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value["mcpServers"] === undefined ? value : value["mcpServers"];
}

function readJson(absolutePath: string): JsonRead {
  const text = readText(absolutePath);
  if (text === undefined) return { kind: "missing" };

  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

function readText(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

function listDirectories(directory: string): readonly string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
      .reduce<readonly string[]>(insertSorted, []);
  } catch {
    return [];
  }
}

function insertSorted(items: readonly string[], item: string): readonly string[] {
  const index = items.findIndex((existing) => item.localeCompare(existing) < 0);
  return index === -1 ? [...items, item] : [...items.slice(0, index), item, ...items.slice(index)];
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match === null) return {};

  const body = match[1] ?? "";
  return body
    .split(/\r?\n/)
    .map((line) => line.split(":"))
    .filter((parts) => parts.length >= 2)
    .reduce<Record<string, string>>((acc, parts) => {
      const key = parts[0]?.trim();
      if (!key) return acc;
      return { ...acc, [key]: parts.slice(1).join(":").trim() };
    }, {});
}
