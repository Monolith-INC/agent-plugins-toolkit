export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly extensions?: Record<string, unknown>;
}

export interface PluginInspection {
  readonly manifest?: PluginManifest;
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
          code: "manifest.invalid_type",
          message: "Plugin manifest must be a JSON object.",
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const name = readRequiredString(value, "name", diagnostics);
  const version = readRequiredString(value, "version", diagnostics);
  const description = readOptionalString(value, "description", diagnostics);
  const extensions = readOptionalRecord(value, "extensions", diagnostics);

  if (!name || !version) return { diagnostics };

  return {
    manifest: {
      name,
      version,
      ...(description === undefined ? {} : { description }),
      ...(extensions === undefined ? {} : { extensions }),
    },
    diagnostics,
  };
}

function readRequiredString(value: Record<string, unknown>, key: string, diagnostics: Diagnostic[]): string | undefined {
  const entry = value[key];
  if (typeof entry === "string" && entry.length > 0) return entry;

  diagnostics.push({
    severity: "error",
    code: `manifest.${key}.required`,
    message: `Manifest field "${key}" must be a non-empty string.`,
    path: key,
  });
  return undefined;
}

function readOptionalString(value: Record<string, unknown>, key: string, diagnostics: Diagnostic[]): string | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;

  diagnostics.push({
    severity: "error",
    code: `manifest.${key}.invalid_type`,
    message: `Manifest field "${key}" must be a string when present.`,
    path: key,
  });
  return undefined;
}

function readOptionalRecord(
  value: Record<string, unknown>,
  key: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (isRecord(entry)) return entry;

  diagnostics.push({
    severity: "error",
    code: `manifest.${key}.invalid_type`,
    message: `Manifest field "${key}" must be an object when present.`,
    path: key,
  });
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
