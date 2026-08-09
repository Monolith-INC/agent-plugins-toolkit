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
  readonly name: string;
  readonly path: string;
  readonly description?: string;
}

export interface PluginMcpServer {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
}

export interface PluginInspection {
  readonly manifest?: PluginManifest;
  readonly skills?: readonly PluginSkill[];
  readonly mcpServers?: readonly PluginMcpServer[];
  readonly diagnostics: readonly Diagnostic[];
}

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

  const diagnostics: Diagnostic[] = [];
  const manifest = readManifest(value, diagnostics);

  return {
    ...(manifest === undefined ? {} : { manifest }),
    diagnostics,
  };
}

export function inspectPlugin(value: unknown): PluginInspection {
  if (!isRecord(value)) {
    return inspectManifest(value);
  }

  const diagnostics: Diagnostic[] = [];
  const manifest = readManifest(value, diagnostics);
  const skills = readSkills(value["skills"], diagnostics);
  const mcpServers = readMcpServers(value["mcpServers"], diagnostics);

  return {
    ...(manifest === undefined ? {} : { manifest }),
    ...(skills === undefined ? {} : { skills }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
    diagnostics,
  };
}

function readManifest(value: Record<string, unknown>, diagnostics: Diagnostic[]): PluginManifest | undefined {
  const name = readRequiredString(value, "name", diagnosticCodes.manifestNameRequired, diagnostics);
  const version = readRequiredString(value, "version", diagnosticCodes.manifestVersionRequired, diagnostics);
  const description = readOptionalString(value, "description", diagnosticCodes.manifestDescriptionInvalidType, diagnostics);
  const extensions = readOptionalRecord(value, "extensions", diagnosticCodes.manifestExtensionsInvalidType, diagnostics);

  if (!name || !version) return undefined;

  return {
    name,
    version,
    ...(description === undefined ? {} : { description }),
    ...(extensions === undefined ? {} : { extensions }),
  };
}

function readSkills(value: unknown, diagnostics: Diagnostic[]): readonly PluginSkill[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      code: diagnosticCodes.skillsInvalidType,
      message: 'Plugin field "skills" must be an array when present.',
      path: "skills",
    });
    return undefined;
  }

  const skills: PluginSkill[] = [];
  value.forEach((entry, index) => {
    const path = `skills[${index}]`;
    if (!isRecord(entry)) {
      diagnostics.push({
        severity: "error",
        code: diagnosticCodes.skillInvalidType,
        message: "Skill entry must be an object.",
        path,
      });
      return;
    }

    const name = readRequiredString(entry, "name", diagnosticCodes.skillNameRequired, diagnostics, path);
    const skillPath = readRequiredString(entry, "path", diagnosticCodes.skillPathRequired, diagnostics, path);
    const description = readOptionalString(
      entry,
      "description",
      diagnosticCodes.skillDescriptionInvalidType,
      diagnostics,
      path,
    );

    if (!name || !skillPath) return;

    skills.push({
      name,
      path: skillPath,
      ...(description === undefined ? {} : { description }),
    });
  });

  return skills;
}

function readMcpServers(value: unknown, diagnostics: Diagnostic[]): readonly PluginMcpServer[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      code: diagnosticCodes.mcpServersInvalidType,
      message: 'Plugin field "mcpServers" must be an array when present.',
      path: "mcpServers",
    });
    return undefined;
  }

  const mcpServers: PluginMcpServer[] = [];
  value.forEach((entry, index) => {
    const path = `mcpServers[${index}]`;
    if (!isRecord(entry)) {
      diagnostics.push({
        severity: "error",
        code: diagnosticCodes.mcpServerInvalidType,
        message: "MCP server entry must be an object.",
        path,
      });
      return;
    }

    const name = readRequiredString(entry, "name", diagnosticCodes.mcpServerNameRequired, diagnostics, path);
    const command = readRequiredString(entry, "command", diagnosticCodes.mcpServerCommandRequired, diagnostics, path);
    const args = readOptionalStringArray(entry, "args", diagnostics, path);

    if (!name || !command) return;

    mcpServers.push({
      name,
      command,
      ...(args === undefined ? {} : { args }),
    });
  });

  return mcpServers;
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  code: DiagnosticCode,
  diagnostics: Diagnostic[],
  parentPath?: string,
): string | undefined {
  const entry = value[key];
  if (typeof entry === "string" && entry.length > 0) return entry;

  diagnostics.push({
    severity: "error",
    code,
    message: `Field "${key}" must be a non-empty string.`,
    path: formatPath(parentPath, key),
  });
  return undefined;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  code: DiagnosticCode,
  diagnostics: Diagnostic[],
  parentPath?: string,
): string | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;

  diagnostics.push({
    severity: "error",
    code,
    message: `Field "${key}" must be a string when present.`,
    path: formatPath(parentPath, key),
  });
  return undefined;
}

function readOptionalRecord(
  value: Record<string, unknown>,
  key: string,
  code: DiagnosticCode,
  diagnostics: Diagnostic[],
  parentPath?: string,
): Record<string, unknown> | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (isRecord(entry)) return entry;

  diagnostics.push({
    severity: "error",
    code,
    message: `Field "${key}" must be an object when present.`,
    path: formatPath(parentPath, key),
  });
  return undefined;
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  key: string,
  diagnostics: Diagnostic[],
  parentPath?: string,
): readonly string[] | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  const path = formatPath(parentPath, key);

  if (!Array.isArray(entry)) {
    diagnostics.push({
      severity: "error",
      code: diagnosticCodes.mcpServerArgsInvalidType,
      message: `Field "${key}" must be an array of strings when present.`,
      path,
    });
    return undefined;
  }

  const invalidIndex = entry.findIndex((item) => typeof item !== "string");
  if (invalidIndex !== -1) {
    diagnostics.push({
      severity: "error",
      code: diagnosticCodes.mcpServerArgInvalidType,
      message: `Field "${key}" must contain only strings.`,
      path: `${path}[${invalidIndex}]`,
    });
    return undefined;
  }

  return entry;
}

function formatPath(parentPath: string | undefined, key: string): string {
  return parentPath === undefined ? key : `${parentPath}.${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
