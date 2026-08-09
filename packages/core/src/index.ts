import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type DiagnosticSeverity = "error" | "warning" | "info";

export const diagnosticCodes = {
  manifestInvalidType: "manifest.invalid_type",
  manifestNameRequired: "manifest.name.required",
  manifestNameInvalid: "manifest.name.invalid",
  manifestVersionRequired: "manifest.version.required",
  manifestDescriptionInvalidType: "manifest.description.invalid_type",
  manifestExtensionsInvalidType: "manifest.extensions.invalid_type",
  manifestSchemaVersionInvalidType: "manifest.schemaVersion.invalid_type",
  manifestSchemaVersionUnsupported: "manifest.schemaVersion.unsupported",
  manifestUnknownField: "manifest.unknown_field",
  skillsInvalidType: "skills.invalid_type",
  skillInvalidType: "skill.invalid_type",
  skillNameRequired: "skill.name.required",
  skillPathRequired: "skill.path.required",
  skillDescriptionInvalidType: "skill.description.invalid_type",
  mcpServersInvalidType: "mcpServers.invalid_type",
  mcpServerInvalidType: "mcpServer.invalid_type",
  mcpServerNameRequired: "mcpServer.name.required",
  mcpServerCommandRequired: "mcpServer.command.required",
  mcpServerUrlRequired: "mcpServer.url.required",
  mcpServerPathRequired: "mcpServer.path.required",
  mcpServerTransportUnsupported: "mcpServer.transport.unsupported",
  mcpServerTransportRequired: "mcpServer.transport.required",
  mcpServerArgsInvalidType: "mcpServer.args.invalid_type",
  mcpServerArgInvalidType: "mcpServer.args.item.invalid_type",
  mcpServerCwdInvalidType: "mcpServer.cwd.invalid_type",
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
  readonly schemaVersion?: string;
  readonly extensions?: Record<string, unknown>;
}

export const SUPPORTED_SCHEMA_VERSION = "1.0.0";

const PORTABLE_MANIFEST_FIELDS = new Set([
  "name",
  "version",
  "description",
  "schemaVersion",
  "extensions",
]);

const DECLARATION_MANIFEST_FIELDS = new Set([...PORTABLE_MANIFEST_FIELDS, "skills", "mcpServers"]);

const PLUGIN_NAME_PATTERN = /^(?:@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface PluginSkill {
  readonly name?: string;
  readonly path: string;
  readonly description?: string;
}

export type PluginPlaceholder = "PLUGIN_ROOT" | "PLUGIN_DATA";

export type PluginMcpTransport = "stdio" | "streamable-http" | "sse" | "config-path";

export type PluginMcpServer =
  | {
      readonly transport: "stdio";
      readonly name?: string;
      readonly command: string;
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly placeholders?: readonly PluginPlaceholder[];
    }
  | {
      readonly transport: "streamable-http";
      readonly name?: string;
      readonly url: string;
      readonly placeholders?: readonly PluginPlaceholder[];
    }
  | {
      readonly transport: "sse";
      readonly name?: string;
      readonly url: string;
      readonly placeholders?: readonly PluginPlaceholder[];
    }
  | {
      readonly transport: "config-path";
      readonly name?: string;
      readonly path: string;
      readonly placeholders?: readonly PluginPlaceholder[];
    };

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

  const manifest = readManifest(value, "portable");
  return {
    ...(manifest.value === undefined ? {} : { manifest: manifest.value }),
    diagnostics: manifest.diagnostics,
  };
}

export function inspectPlugin(value: unknown): PluginInspection {
  if (!isRecord(value)) {
    return inspectManifest(value);
  }

  const manifest = readManifest(value, "declaration");
  const skills = readSkills(value["skills"]);
  const mcpServers = readMcpServers(value["mcpServers"]);

  return {
    ...(manifest.value === undefined ? {} : { manifest: manifest.value }),
    ...optionalSkills(skills.value),
    ...optionalMcpServers(mcpServers.value),
    diagnostics: [...manifest.diagnostics, ...skills.diagnostics, ...mcpServers.diagnostics],
  };
}

function readManifest(
  value: Record<string, unknown>,
  mode: "portable" | "declaration",
): ReadResult<PluginManifest> {
  const allowed = mode === "portable" ? PORTABLE_MANIFEST_FIELDS : DECLARATION_MANIFEST_FIELDS;
  const unknownFields = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .reduce<readonly string[]>(insertSorted, [])
    .map((key) =>
      createDiagnostic({
        severity: "error",
        code: diagnosticCodes.manifestUnknownField,
        message:
          mode === "portable"
            ? `Unknown portable manifest field "${key}" is not allowed by Agent Plugins v1.0.0.`
            : `Unknown declaration field "${key}" is not allowed by Agent Plugins v1.0.0.`,
        path: key,
      }),
    );

  const name = readPluginName(value);
  const version = readRequiredString(value, "version", diagnosticCodes.manifestVersionRequired);
  const description = readOptionalString(value, "description", diagnosticCodes.manifestDescriptionInvalidType);
  const schemaVersion = readSchemaVersion(value);
  const extensions = readOptionalRecord(value, "extensions", diagnosticCodes.manifestExtensionsInvalidType);
  const diagnostics = [
    ...unknownFields,
    ...name.diagnostics,
    ...version.diagnostics,
    ...description.diagnostics,
    ...schemaVersion.diagnostics,
    ...extensions.diagnostics,
  ];
  const blocked = diagnostics.some((diagnostic) => isManifestRejection(diagnostic.code));

  return name.value === undefined || version.value === undefined || blocked
    ? { diagnostics }
    : {
        value: {
          name: name.value,
          version: version.value,
          ...(description.value === undefined ? {} : { description: description.value }),
          ...(schemaVersion.value === undefined ? {} : { schemaVersion: schemaVersion.value }),
          ...(extensions.value === undefined ? {} : { extensions: extensions.value }),
        },
        diagnostics,
      };
}

function isManifestRejection(code: DiagnosticCode): boolean {
  switch (code) {
    case diagnosticCodes.manifestUnknownField:
    case diagnosticCodes.manifestSchemaVersionUnsupported:
    case diagnosticCodes.manifestSchemaVersionInvalidType:
    case diagnosticCodes.manifestNameInvalid:
      return true;
    default:
      return false;
  }
}

function readPluginName(value: Record<string, unknown>): ReadResult<string> {
  const required = readRequiredString(value, "name", diagnosticCodes.manifestNameRequired);
  if (required.value === undefined) return required;
  return PLUGIN_NAME_PATTERN.test(required.value)
    ? required
    : {
        diagnostics: [
          ...required.diagnostics,
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.manifestNameInvalid,
            message:
              'Manifest field "name" must be a lowercase npm-style package name (optional @scope/).',
            path: "name",
          }),
        ],
      };
}

function readSchemaVersion(value: Record<string, unknown>): ReadResult<string> {
  const entry = value["schemaVersion"];
  if (entry === undefined) return { diagnostics: [] };
  if (typeof entry !== "string" || entry.length === 0) {
    return {
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: diagnosticCodes.manifestSchemaVersionInvalidType,
          message: 'Manifest field "schemaVersion" must be a non-empty string when present.',
          path: "schemaVersion",
        }),
      ],
    };
  }
  return entry === SUPPORTED_SCHEMA_VERSION
    ? { value: entry, diagnostics: [] }
    : {
        value: entry,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.manifestSchemaVersionUnsupported,
            message: `Unsupported schemaVersion "${entry}". Supported: ${SUPPORTED_SCHEMA_VERSION}.`,
            path: "schemaVersion",
          }),
        ],
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
    return { value: [configPathServer(undefined, value)], diagnostics: [] };
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
      const parsed = readMcpServerRecord(entry, path, name.value);
      const diagnostics = [...acc.diagnostics, ...name.diagnostics, ...parsed.diagnostics];
      return name.value === undefined || parsed.value === undefined
        ? { value: acc.value ?? [], diagnostics }
        : {
            value: [...(acc.value ?? []), parsed.value],
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
          value: [...(acc.value ?? []), configPathServer(name, entry)],
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

      const parsed = readMcpServerRecord(entry, path, name);
      return {
        value: [...(acc.value ?? []), ...(parsed.value === undefined ? [] : [parsed.value])],
        diagnostics: [...acc.diagnostics, ...parsed.diagnostics],
      };
    },
    { value: [], diagnostics: [] },
  );
}

function readMcpServerRecord(
  entry: Record<string, unknown>,
  path: string,
  name: string | undefined,
): ReadResult<PluginMcpServer> {
  const transport = readDeclaredTransport(entry, path);
  if (transport.diagnostics.length > 0 && transport.value === undefined) {
    return { diagnostics: transport.diagnostics };
  }

  switch (transport.value) {
    case "stdio":
      return readStdioServer(entry, path, name, transport.diagnostics);
    case "streamable-http":
    case "sse":
      return readHttpServer(entry, path, name, transport.value, transport.diagnostics);
    case "config-path": {
      const configPath = readRequiredString(entry, "path", diagnosticCodes.mcpServerPathRequired, path);
      return configPath.value === undefined
        ? { diagnostics: [...transport.diagnostics, ...configPath.diagnostics] }
        : {
            value: configPathServer(name, configPath.value),
            diagnostics: [...transport.diagnostics, ...configPath.diagnostics],
          };
    }
    case undefined:
      return inferMcpServer(entry, path, name, transport.diagnostics);
    default:
      return { diagnostics: transport.diagnostics };
  }
}

function inferMcpServer(
  entry: Record<string, unknown>,
  path: string,
  name: string | undefined,
  prior: readonly Diagnostic[],
): ReadResult<PluginMcpServer> {
  const hasCommand = entry["command"] !== undefined;
  const hasUrl = entry["url"] !== undefined;
  switch (true) {
    case hasCommand:
      return readStdioServer(entry, path, name, prior);
    case hasUrl:
      return {
        diagnostics: [
          ...prior,
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.mcpServerTransportRequired,
            message:
              'MCP server with "url" must declare transport "streamable-http" or "sse" via "type" or "transport".',
            path: formatPath(path, "transport"),
          }),
        ],
      };
    default:
      return readStdioServer(entry, path, name, prior);
  }
}

function readDeclaredTransport(
  entry: Record<string, unknown>,
  path: string,
): ReadResult<PluginMcpTransport> {
  const raw = entry["type"] ?? entry["transport"];
  if (raw === undefined) return { diagnostics: [] };
  switch (raw) {
    case "stdio":
      return { value: "stdio", diagnostics: [] };
    case "streamable-http":
      return { value: "streamable-http", diagnostics: [] };
    case "sse":
      return { value: "sse", diagnostics: [] };
    case "config-path":
      return { value: "config-path", diagnostics: [] };
    default:
      return {
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: diagnosticCodes.mcpServerTransportUnsupported,
            message:
              'MCP server transport must be one of "stdio", "streamable-http", "sse", or "config-path".',
            path: formatPath(path, typeof entry["type"] === "undefined" ? "transport" : "type"),
          }),
        ],
      };
  }
}

function readStdioServer(
  entry: Record<string, unknown>,
  path: string,
  name: string | undefined,
  prior: readonly Diagnostic[],
): ReadResult<PluginMcpServer> {
  const command = readRequiredString(entry, "command", diagnosticCodes.mcpServerCommandRequired, path);
  const args = readOptionalStringArray(entry, "args", path);
  const cwd = readOptionalString(entry, "cwd", diagnosticCodes.mcpServerCwdInvalidType, path);
  const diagnostics = [...prior, ...command.diagnostics, ...args.diagnostics, ...cwd.diagnostics];
  return command.value === undefined || !args.isValid
    ? { diagnostics }
    : {
        value: withPlaceholders({
          transport: "stdio",
          ...(name === undefined ? {} : { name }),
          command: command.value,
          ...(args.value === undefined ? {} : { args: args.value }),
          ...(cwd.value === undefined ? {} : { cwd: cwd.value }),
        }),
        diagnostics,
      };
}

function readHttpServer(
  entry: Record<string, unknown>,
  path: string,
  name: string | undefined,
  transport: "streamable-http" | "sse",
  prior: readonly Diagnostic[],
): ReadResult<PluginMcpServer> {
  const url = readRequiredString(entry, "url", diagnosticCodes.mcpServerUrlRequired, path);
  const diagnostics = [...prior, ...url.diagnostics];
  return url.value === undefined
    ? { diagnostics }
    : {
        value: withPlaceholders({
          transport,
          ...(name === undefined ? {} : { name }),
          url: url.value,
        }),
        diagnostics,
      };
}

function configPathServer(name: string | undefined, configPath: string): PluginMcpServer {
  return withPlaceholders({
    transport: "config-path",
    ...(name === undefined ? {} : { name }),
    path: configPath,
  });
}

function withPlaceholders<T extends PluginMcpServer>(server: T): T {
  const values = collectPlaceholderValues(server);
  const placeholders = collectPlaceholders(...values);
  return placeholders.length === 0 ? server : ({ ...server, placeholders } as T);
}

function collectPlaceholderValues(server: PluginMcpServer): readonly (string | undefined)[] {
  switch (server.transport) {
    case "stdio":
      return [server.command, server.cwd, ...(server.args ?? [])];
    case "streamable-http":
    case "sse":
      return [server.url];
    case "config-path":
      return [server.path];
  }
}

const PLACEHOLDER_PATTERN = /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g;

function collectPlaceholders(...values: readonly (string | undefined)[]): readonly PluginPlaceholder[] {
  return values
    .flatMap((value) => (value === undefined ? [] : [...value.matchAll(PLACEHOLDER_PATTERN)]))
    .map((match) => match[1] as PluginPlaceholder)
    .reduce<readonly PluginPlaceholder[]>(
      (acc, placeholder) => (acc.includes(placeholder) ? acc : insertSortedPlaceholder(acc, placeholder)),
      [],
    );
}

function insertSortedPlaceholder(
  items: readonly PluginPlaceholder[],
  item: PluginPlaceholder,
): readonly PluginPlaceholder[] {
  const index = items.findIndex((existing) => item.localeCompare(existing, "en") < 0);
  return index === -1 ? [...items, item] : [...items.slice(0, index), item, ...items.slice(index)];
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

function optionalSkills(value: readonly PluginSkill[] | undefined): { readonly skills?: readonly PluginSkill[] } {
  return value === undefined || value.length === 0 ? {} : { skills: value };
}

function optionalMcpServers(
  value: readonly PluginMcpServer[] | undefined,
): { readonly mcpServers?: readonly PluginMcpServer[] } {
  return value === undefined || value.length === 0 ? {} : { mcpServers: value };
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
  const skillDiscovery = discoverSkills(pluginRoot);
  const mcpDiscovery = discoverMcpServers(pluginRoot);
  return foldManifestRead(readJson(join(pluginRoot, "plugin.json")), skillDiscovery, mcpDiscovery);
}

function foldManifestRead(
  manifestRead: JsonRead,
  skillDiscovery: {
    readonly skills: readonly Record<string, unknown>[];
    readonly diagnostics: readonly Diagnostic[];
  },
  mcpDiscovery: {
    readonly mcpServers: unknown;
    readonly diagnostics: readonly Diagnostic[];
  },
): PluginInspection {
  switch (manifestRead.kind) {
    case "missing":
      return inspectionWithoutReadableManifest(
        "Plugin manifest could not be read.",
        skillDiscovery,
        mcpDiscovery,
      );
    case "invalid":
      return inspectionWithoutReadableManifest(
        "Plugin manifest could not be parsed as JSON.",
        skillDiscovery,
        mcpDiscovery,
      );
    case "ok":
      return inspectLoadedPlugin(manifestRead.value, skillDiscovery, mcpDiscovery);
  }
}

function inspectionWithoutReadableManifest(
  message: string,
  skillDiscovery: {
    readonly skills: readonly Record<string, unknown>[];
    readonly diagnostics: readonly Diagnostic[];
  },
  mcpDiscovery: {
    readonly mcpServers: unknown;
    readonly diagnostics: readonly Diagnostic[];
  },
): PluginInspection {
  const skills = readSkills(skillDiscovery.skills.length === 0 ? undefined : skillDiscovery.skills);
  const mcpServers = readMcpServers(mcpDiscovery.mcpServers);

  return {
    ...optionalSkills(skills.value),
    ...optionalMcpServers(mcpServers.value),
    diagnostics: [
      createDiagnostic({
        severity: "error",
        code: diagnosticCodes.manifestUnreadable,
        message,
        path: "plugin.json",
      }),
      ...skillDiscovery.diagnostics,
      ...mcpDiscovery.diagnostics,
      ...skills.diagnostics,
      ...mcpServers.diagnostics,
    ],
  };
}

function inspectLoadedPlugin(
  manifestValue: unknown,
  skillDiscovery: {
    readonly skills: readonly Record<string, unknown>[];
    readonly diagnostics: readonly Diagnostic[];
  },
  mcpDiscovery: {
    readonly mcpServers: unknown;
    readonly diagnostics: readonly Diagnostic[];
  },
): PluginInspection {
  if (!isRecord(manifestValue)) {
    const manifestInspection = inspectManifest(manifestValue);
    const skills = readSkills(skillDiscovery.skills.length === 0 ? undefined : skillDiscovery.skills);
    const mcpServers = readMcpServers(mcpDiscovery.mcpServers);

    return {
      ...manifestInspection,
      ...optionalSkills(skills.value),
      ...optionalMcpServers(mcpServers.value),
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
  const index = items.findIndex((existing) => item.localeCompare(existing, "en") < 0);
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
