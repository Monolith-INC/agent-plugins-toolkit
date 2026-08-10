import { createHash } from "node:crypto";

import type {
  Diagnostic,
  PluginManifest,
  PluginMcpServer,
} from "@agent-plugins/core";

export const BUNDLE_SCHEMA_VERSION = "1.0.0" as const;
export const CANONICAL_SCHEMA_VERSION = "1.0.0" as const;
export const ADAPTER_CONTRACT_VERSION = "1.0.0" as const;
export const VENDOR_IDS = Object.freeze(["claude", "codex", "cursor"] as const);

export type VendorId = (typeof VENDOR_IDS)[number];
export type BundleSchemaVersion = typeof BUNDLE_SCHEMA_VERSION;
export type CanonicalSchemaVersion = typeof CANONICAL_SCHEMA_VERSION;
export type AdapterContractVersion = typeof ADAPTER_CONTRACT_VERSION;
export type Sha256 = string & { readonly __brand: "Sha256" };
export type RelativePayloadPath = string & { readonly __brand: "RelativePayloadPath" };
export type PortableFileMode = 0o644 | 0o755;

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    };

export interface CanonicalSkill {
  readonly name: string;
  readonly path: string;
  readonly description?: string;
  readonly content: string;
}

export type CanonicalRuleActivation = "always" | "model-decides";

export interface CanonicalRule {
  readonly id: string;
  readonly description?: string;
  readonly activation: CanonicalRuleActivation;
  readonly fileGlobs: readonly string[];
  readonly content: string;
}

export type CanonicalHookLifecycle =
  | "session-start"
  | "session-end"
  | "before-tool"
  | "after-tool"
  | "before-prompt"
  | "stop";

export type CanonicalToolKind = "shell" | "file-read" | "file-write" | "mcp";

export interface CanonicalHookIntent {
  readonly id: string;
  readonly lifecycle: CanonicalHookLifecycle;
  readonly toolKinds: readonly CanonicalToolKind[];
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly timeoutSeconds?: number;
}

export interface CanonicalDistribution {
  readonly schemaVersion: CanonicalSchemaVersion;
  readonly compatibility: {
    readonly bundleSchemaMajor: 1;
    readonly allowDowngradeWithinMajor: boolean;
  };
}

export interface CanonicalPlugin {
  readonly root: string;
  readonly manifest: PluginManifest;
  readonly skills: readonly CanonicalSkill[];
  readonly mcpServers: readonly PluginMcpServer[];
  readonly rules: readonly CanonicalRule[];
  readonly hookIntents: readonly CanonicalHookIntent[];
  readonly distribution: CanonicalDistribution;
  readonly sourceDigest: Sha256;
}

export interface PayloadFile {
  readonly path: RelativePayloadPath;
  readonly content: Uint8Array;
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly mode: PortableFileMode;
}

export interface PayloadFileDescriptor {
  readonly path: RelativePayloadPath;
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly mode: PortableFileMode;
}

export interface VendorBundleManifest {
  readonly schemaVersion: BundleSchemaVersion;
  readonly plugin: {
    readonly name: string;
    readonly version: string;
  };
  readonly vendor: VendorId;
  readonly adapter: {
    readonly version: string;
    readonly vendorSchemaVersion: string;
  };
  readonly sourceDigest: Sha256;
  readonly payloadDigest: Sha256;
  readonly files: readonly PayloadFileDescriptor[];
}

export interface VendorBundle {
  readonly manifest: VendorBundleManifest;
  readonly files: readonly PayloadFile[];
}

export interface VendorBundleDraft {
  readonly plugin: {
    readonly name: string;
    readonly version: string;
  };
  readonly vendor: VendorId;
  readonly adapter: {
    readonly version: string;
    readonly vendorSchemaVersion: string;
  };
  readonly sourceDigest: Sha256;
  readonly files: readonly PayloadFile[];
}

export interface InstallTarget {
  readonly root: string;
}

export interface InstallWrite {
  readonly source: RelativePayloadPath;
  readonly destination: RelativePayloadPath;
  readonly mode: PortableFileMode;
}

export interface InstallPlan {
  readonly plugin: string;
  readonly version: string;
  readonly vendor: VendorId;
  readonly bundleDigest: Sha256;
  readonly writes: readonly InstallWrite[];
}

export interface InstalledBundleRecord {
  readonly schemaVersion: BundleSchemaVersion;
  readonly plugin: string;
  readonly version: string;
  readonly vendor: VendorId;
  readonly adapterVersion: string;
  readonly sourceDigest: Sha256;
  readonly payloadDigest: Sha256;
  readonly installedFiles: readonly {
    readonly path: RelativePayloadPath;
    readonly sha256: Sha256;
    readonly mode: PortableFileMode;
  }[];
}

export type JournalEntry =
  | { readonly kind: "created"; readonly path: RelativePayloadPath }
  | {
      readonly kind: "replaced";
      readonly path: RelativePayloadPath;
      readonly backupPath: RelativePayloadPath;
      readonly priorSha256: Sha256;
      readonly priorMode: PortableFileMode;
    }
  | {
      readonly kind: "removed";
      readonly path: RelativePayloadPath;
      readonly backupPath: RelativePayloadPath;
      readonly priorSha256: Sha256;
      readonly priorMode: PortableFileMode;
    };

export type InstallResult =
  | {
      readonly kind: "installed";
      readonly changedPaths: number;
      readonly record: InstalledBundleRecord;
    }
  | {
      readonly kind: "unchanged";
      readonly changedPaths: 0;
      readonly record: InstalledBundleRecord;
    }
  | {
      readonly kind: "failed-before-mutation";
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly kind: "rolled-back";
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly kind: "rollback-failed";
      readonly diagnostics: readonly Diagnostic[];
      readonly recoveryJournal: string;
    };

export type CompileResult =
  | {
      readonly ok: true;
      readonly bundle: VendorBundleManifest;
      readonly output: string;
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export type VerificationResult =
  | {
      readonly ok: true;
      readonly sourceDigest: Sha256;
      readonly payloadDigest: Sha256;
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export const compilerDiagnosticCodes = Object.freeze({
  vendorUnsupported: "adapter.vendor.unsupported",
  sha256Invalid: "bundle.sha256.invalid",
  pathInvalid: "bundle.path.invalid",
  fileModeInvalid: "bundle.file.mode.invalid",
  fileDigestMismatch: "bundle.file.digest_mismatch",
  fileLengthMismatch: "bundle.file.length_mismatch",
  fileDuplicate: "bundle.file.duplicate",
  fileOrderInvalid: "bundle.file.order_invalid",
  payloadDigestMismatch: "bundle.payload.digest_mismatch",
  manifestInvalid: "bundle.manifest.invalid",
  manifestUnknownField: "bundle.manifest.unknown_field",
  identityInvalid: "bundle.identity.invalid",
  adapterVersionInvalid: "adapter.version.invalid",
  planInvalid: "install.preflight.plan.invalid",
  planSourceMissing: "install.preflight.plan.source_missing",
  planSourceDuplicate: "install.preflight.plan.source_duplicate",
  planDestinationDuplicate: "install.preflight.plan.destination_duplicate",
  planOrderInvalid: "install.preflight.plan.order_invalid",
} as const);

export type CompilerDiagnosticCode =
  (typeof compilerDiagnosticCodes)[keyof typeof compilerDiagnosticCodes];

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure(
  first: Diagnostic,
  ...rest: readonly Diagnostic[]
): Result<never> {
  return { ok: false, diagnostics: [first, ...rest] };
}

export function parseVendorId(value: string): Result<VendorId> {
  switch (value) {
    case "claude":
    case "codex":
    case "cursor":
      return success(value);
    default:
      return failure(
        diagnostic(
          compilerDiagnosticCodes.vendorUnsupported,
          `Unsupported vendor "${value}". Expected claude, codex, or cursor.`,
          "vendor",
        ),
      );
  }
}

export function parseSha256(value: string): Result<Sha256> {
  return /^[0-9a-f]{64}$/.test(value)
    ? success(value as Sha256)
    : failure(
        diagnostic(
          compilerDiagnosticCodes.sha256Invalid,
          "SHA-256 values must contain exactly 64 lowercase hexadecimal characters.",
        ),
      );
}

export function parseRelativePayloadPath(value: string): Result<RelativePayloadPath> {
  const invalid =
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.startsWith("//") ||
    /^[A-Za-z]:\//.test(value) ||
    value !== value.normalize("NFC") ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..");

  return invalid
    ? failure(
        diagnostic(
          compilerDiagnosticCodes.pathInvalid,
          "Payload paths must be non-empty NFC-normalized relative paths with '/' separators and no traversal segments.",
          value,
        ),
      )
    : success(value as RelativePayloadPath);
}

export function parsePortableFileMode(value: number): Result<PortableFileMode> {
  switch (value) {
    case 0o644:
    case 0o755:
      return success(value);
    default:
      return failure(
        diagnostic(
          compilerDiagnosticCodes.fileModeInvalid,
          "Portable file mode must be 0644 or 0755.",
        ),
      );
  }
}

export function canonicalText(value: string): string {
  const withoutBom = value.startsWith("\uFEFF") ? value.slice(1) : value;
  return `${withoutBom.replace(/\r\n?/g, "\n").replace(/\n*$/g, "")}\n`;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function stableJson(value: JsonValue): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function sha256(content: Uint8Array | string): Sha256 {
  return createHash("sha256").update(content).digest("hex") as Sha256;
}

export function createPayloadFile(input: {
  readonly path: string;
  readonly content: Uint8Array | string;
  readonly mode?: number;
  readonly text?: boolean;
}): Result<PayloadFile> {
  const path = parseRelativePayloadPath(input.path);
  if (!path.ok) return path;
  const mode = parsePortableFileMode(input.mode ?? 0o644);
  if (!mode.ok) return mode;

  const content =
    typeof input.content === "string"
      ? Buffer.from(canonicalText(input.content), "utf8")
      : input.text === true
        ? Buffer.from(canonicalText(Buffer.from(input.content).toString("utf8")), "utf8")
        : Uint8Array.from(input.content);

  return success({
    path: path.value,
    content,
    sha256: sha256(content),
    bytes: content.byteLength,
    mode: mode.value,
  });
}

export function payloadDescriptor(file: PayloadFile): PayloadFileDescriptor {
  return {
    path: file.path,
    sha256: file.sha256,
    bytes: file.bytes,
    mode: file.mode,
  };
}

export function computePayloadDigest(files: readonly PayloadFile[]): Sha256 {
  return sha256(
    files
      .map(
        (file) =>
          `${file.path}\0${file.mode}\0${file.bytes}\0${file.sha256}\n`,
      )
      .join(""),
  );
}

export function finalizeVendorBundle(draft: VendorBundleDraft): Result<VendorBundle> {
  const files = [...draft.files].sort(comparePayloadFiles);
  const candidate: VendorBundle = {
    manifest: {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      plugin: { name: draft.plugin.name, version: draft.plugin.version },
      vendor: draft.vendor,
      adapter: {
        version: draft.adapter.version,
        vendorSchemaVersion: draft.adapter.vendorSchemaVersion,
      },
      sourceDigest: draft.sourceDigest,
      payloadDigest: computePayloadDigest(files),
      files: files.map(payloadDescriptor),
    },
    files,
  };
  const diagnostics = validateVendorBundle(candidate);
  return diagnostics.length === 0
    ? success(candidate)
    : failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
}

export function validateVendorBundle(bundle: VendorBundle): readonly Diagnostic[] {
  const identityDiagnostics = validateBundleIdentity(bundle.manifest);
  const manifestFiles = bundle.manifest.files;
  const actualFiles = bundle.files;
  const manifestFileDiagnostics = manifestFiles.flatMap(validatePayloadFileDescriptor);
  const fileDiagnostics = actualFiles.flatMap(validatePayloadFile);
  const duplicateDiagnostics = [
    ...duplicatePathDiagnostics(actualFiles.map((file) => file.path)),
    ...duplicatePathDiagnostics(manifestFiles.map((file) => file.path)),
  ];
  const orderDiagnostics = isLexicallySorted(actualFiles.map((file) => file.path)) &&
      isLexicallySorted(manifestFiles.map((file) => file.path))
    ? []
    : [diagnostic(compilerDiagnosticCodes.fileOrderInvalid, "Bundle files must be ordered lexically by normalized path.")];
  const descriptorDiagnostics = validateDescriptors(manifestFiles, actualFiles);
  const digest = computePayloadDigest(actualFiles);
  const payloadDiagnostics = digest === bundle.manifest.payloadDigest
    ? []
    : [
        diagnostic(
          compilerDiagnosticCodes.payloadDigestMismatch,
          "Bundle payload digest does not match its files.",
        ),
      ];

  return [
    ...identityDiagnostics,
    ...manifestFileDiagnostics,
    ...fileDiagnostics,
    ...duplicateDiagnostics,
    ...orderDiagnostics,
    ...descriptorDiagnostics,
    ...payloadDiagnostics,
  ];
}

export function validateInstallPlan(
  plan: InstallPlan,
  bundle: VendorBundle,
): readonly Diagnostic[] {
  const identityDiagnostics =
    plan.plugin === bundle.manifest.plugin.name &&
    plan.version === bundle.manifest.plugin.version &&
    plan.vendor === bundle.manifest.vendor &&
    plan.bundleDigest === bundle.manifest.payloadDigest
      ? []
      : [
          diagnostic(
            compilerDiagnosticCodes.planInvalid,
            "Installation plan identity must match exactly one bundle.",
          ),
        ];
  const sourcePaths = plan.writes.map((write) => write.source);
  const destinations = plan.writes.map((write) => write.destination);
  const bundlePaths = new Set(bundle.files.map((file) => file.path));
  const sourceDiagnostics = sourcePaths.flatMap((source) =>
    bundlePaths.has(source)
      ? []
      : [
          diagnostic(
            compilerDiagnosticCodes.planSourceMissing,
            "Installation plan source does not exist in the bundle.",
            source,
          ),
        ],
  );
  const missingSources = bundle.files.flatMap((file) =>
    sourcePaths.includes(file.path)
      ? []
      : [
          diagnostic(
            compilerDiagnosticCodes.planSourceMissing,
            "Every bundle file must appear exactly once in the installation plan.",
            file.path,
          ),
        ],
  );
  const sourceDuplicates = duplicateDiagnostics(
    sourcePaths,
    compilerDiagnosticCodes.planSourceDuplicate,
    "Installation plan sources must be unique.",
  );
  const destinationDuplicates = duplicateDiagnostics(
    destinations,
    compilerDiagnosticCodes.planDestinationDuplicate,
    "Installation plan destinations must be unique.",
  );
  const pathDiagnostics = plan.writes.flatMap((write) => [write.source, write.destination])
    .flatMap((path) => {
      const parsed = parseRelativePayloadPath(path);
      return parsed.ok ? [] : parsed.diagnostics;
    });
  const modeDiagnostics = plan.writes.flatMap((write) => {
    const parsed = parsePortableFileMode(write.mode);
    return parsed.ok ? [] : parsed.diagnostics;
  });
  const orderDiagnostics = isLexicallySorted(destinations)
    ? []
    : [
        diagnostic(
          compilerDiagnosticCodes.planOrderInvalid,
          "Installation writes must be ordered lexically by destination.",
        ),
      ];

  return [
    ...identityDiagnostics,
    ...sourceDiagnostics,
    ...missingSources,
    ...sourceDuplicates,
    ...destinationDuplicates,
    ...pathDiagnostics,
    ...modeDiagnostics,
    ...orderDiagnostics,
  ];
}

export function parseVendorBundleManifest(value: unknown): Result<VendorBundleManifest> {
  if (!isRecord(value)) {
    return failure(
      diagnostic(compilerDiagnosticCodes.manifestInvalid, "Bundle manifest must be a JSON object."),
    );
  }

  const unknown = unknownFields(value, [
    "schemaVersion",
    "plugin",
    "vendor",
    "adapter",
    "sourceDigest",
    "payloadDigest",
    "files",
  ]);
  if (unknown.length > 0) return failure(unknown[0] as Diagnostic, ...unknown.slice(1));

  const plugin = parsePluginIdentity(value["plugin"]);
  const vendor = typeof value["vendor"] === "string" ? parseVendorId(value["vendor"]) : invalidManifest("vendor");
  const adapter = parseAdapterIdentity(value["adapter"]);
  const sourceDigest = typeof value["sourceDigest"] === "string"
    ? parseSha256(value["sourceDigest"])
    : invalidManifest("sourceDigest");
  const payloadDigest = typeof value["payloadDigest"] === "string"
    ? parseSha256(value["payloadDigest"])
    : invalidManifest("payloadDigest");
  const files = parseFileDescriptors(value["files"]);
  const schemaValid = value["schemaVersion"] === BUNDLE_SCHEMA_VERSION;
  const failures = [plugin, vendor, adapter, sourceDigest, payloadDigest, files]
    .flatMap((result) => result.ok ? [] : result.diagnostics);
  if (!schemaValid) {
    failures.unshift(
      diagnostic(
        compilerDiagnosticCodes.manifestInvalid,
        `Bundle schema version must be ${BUNDLE_SCHEMA_VERSION}.`,
        "schemaVersion",
      ),
    );
  }
  if (failures.length > 0) return failure(failures[0] as Diagnostic, ...failures.slice(1));
  if (!plugin.ok || !vendor.ok || !adapter.ok || !sourceDigest.ok || !payloadDigest.ok || !files.ok) {
    return failure(diagnostic(compilerDiagnosticCodes.manifestInvalid, "Bundle manifest is invalid."));
  }

  return success({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    plugin: plugin.value,
    vendor: vendor.value,
    adapter: adapter.value,
    sourceDigest: sourceDigest.value,
    payloadDigest: payloadDigest.value,
    files: files.value,
  });
}

function validateBundleIdentity(manifest: VendorBundleManifest): readonly Diagnostic[] {
  const schema = manifest.schemaVersion === BUNDLE_SCHEMA_VERSION
    ? []
    : [
        diagnostic(
          compilerDiagnosticCodes.manifestInvalid,
          `Bundle schema version must be ${BUNDLE_SCHEMA_VERSION}.`,
          "schemaVersion",
        ),
      ];
  const identity = manifest.plugin.name.length > 0 && manifest.plugin.version.length > 0
    ? []
    : [diagnostic(compilerDiagnosticCodes.identityInvalid, "Bundle plugin name and version must be non-empty.")];
  const adapter = manifest.adapter.version.length > 0 && manifest.adapter.vendorSchemaVersion.length > 0
    ? []
    : [diagnostic(compilerDiagnosticCodes.adapterVersionInvalid, "Adapter and vendor schema versions must be non-empty.")];
  const vendor = parseVendorId(manifest.vendor);
  const sourceDigest = parseSha256(manifest.sourceDigest);
  const payloadDigest = parseSha256(manifest.payloadDigest);
  return [
    ...schema,
    ...identity,
    ...adapter,
    ...(vendor.ok ? [] : vendor.diagnostics),
    ...(sourceDigest.ok ? [] : sourceDigest.diagnostics),
    ...(payloadDigest.ok ? [] : payloadDigest.diagnostics),
  ];
}

function validatePayloadFileDescriptor(
  descriptor: PayloadFileDescriptor,
): readonly Diagnostic[] {
  const path = parseRelativePayloadPath(descriptor.path);
  const digest = parseSha256(descriptor.sha256);
  const mode = parsePortableFileMode(descriptor.mode);
  const bytesValid = Number.isSafeInteger(descriptor.bytes) && descriptor.bytes >= 0;
  return [
    ...(path.ok ? [] : path.diagnostics),
    ...(digest.ok ? [] : digest.diagnostics),
    ...(mode.ok ? [] : mode.diagnostics),
    ...(bytesValid
      ? []
      : [
          diagnostic(
            compilerDiagnosticCodes.manifestInvalid,
            "Payload byte length must be a non-negative safe integer.",
            descriptor.path,
          ),
        ]),
  ];
}

function validatePayloadFile(file: PayloadFile): readonly Diagnostic[] {
  const path = parseRelativePayloadPath(file.path);
  const mode = parsePortableFileMode(file.mode);
  const digest = sha256(file.content);
  return [
    ...(path.ok ? [] : path.diagnostics),
    ...(mode.ok ? [] : mode.diagnostics),
    ...(digest === file.sha256
      ? []
      : [diagnostic(compilerDiagnosticCodes.fileDigestMismatch, "Payload file digest does not match its bytes.", file.path)]),
    ...(file.content.byteLength === file.bytes
      ? []
      : [diagnostic(compilerDiagnosticCodes.fileLengthMismatch, "Payload file length does not match its bytes.", file.path)]),
  ];
}

function validateDescriptors(
  descriptors: readonly PayloadFileDescriptor[],
  files: readonly PayloadFile[],
): readonly Diagnostic[] {
  if (descriptors.length !== files.length) {
    return [diagnostic(compilerDiagnosticCodes.manifestInvalid, "Bundle manifest and payload file counts differ.")];
  }
  return descriptors.flatMap((descriptor, index) => {
    const file = files[index];
    return file !== undefined &&
      descriptor.path === file.path &&
      descriptor.sha256 === file.sha256 &&
      descriptor.bytes === file.bytes &&
      descriptor.mode === file.mode
      ? []
      : [
          diagnostic(
            compilerDiagnosticCodes.manifestInvalid,
            "Bundle manifest file descriptor does not match payload bytes.",
            descriptor.path,
          ),
        ];
  });
}

function duplicatePathDiagnostics(paths: readonly string[]): readonly Diagnostic[] {
  return duplicateDiagnostics(
    paths,
    compilerDiagnosticCodes.fileDuplicate,
    "Bundle payload paths must be unique after normalization.",
  );
}

function duplicateDiagnostics(
  values: readonly string[],
  code: CompilerDiagnosticCode,
  message: string,
): readonly Diagnostic[] {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  return [...new Set(duplicates)].map((value) => diagnostic(code, message, value));
}

function parsePluginIdentity(value: unknown): Result<{ readonly name: string; readonly version: string }> {
  if (!isRecord(value)) return invalidManifest("plugin");
  const unknown = unknownFields(value, ["name", "version"]);
  if (unknown.length > 0) return failure(unknown[0] as Diagnostic, ...unknown.slice(1));
  const name = value["name"];
  const version = value["version"];
  return typeof name === "string" && name.length > 0 && typeof version === "string" && version.length > 0
    ? success({ name, version })
    : invalidManifest("plugin");
}

function parseAdapterIdentity(value: unknown): Result<{
  readonly version: string;
  readonly vendorSchemaVersion: string;
}> {
  if (!isRecord(value)) return invalidManifest("adapter");
  const unknown = unknownFields(value, ["version", "vendorSchemaVersion"]);
  if (unknown.length > 0) return failure(unknown[0] as Diagnostic, ...unknown.slice(1));
  const version = value["version"];
  const vendorSchemaVersion = value["vendorSchemaVersion"];
  return typeof version === "string" && version.length > 0 &&
      typeof vendorSchemaVersion === "string" && vendorSchemaVersion.length > 0
    ? success({ version, vendorSchemaVersion })
    : invalidManifest("adapter");
}

function parseFileDescriptors(value: unknown): Result<readonly PayloadFileDescriptor[]> {
  if (!Array.isArray(value)) return invalidManifest("files");
  const results = value.map(parseFileDescriptor);
  const diagnostics = results.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (diagnostics.length > 0) return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  const files = results.flatMap((result) => result.ok ? [result.value] : []);
  const duplicates = duplicatePathDiagnostics(files.map((file) => file.path));
  const order = isLexicallySorted(files.map((file) => file.path))
    ? []
    : [diagnostic(compilerDiagnosticCodes.fileOrderInvalid, "Bundle manifest files must be lexically ordered.")];
  const failures = [...duplicates, ...order];
  return failures.length === 0
    ? success(files)
    : failure(failures[0] as Diagnostic, ...failures.slice(1));
}

function parseFileDescriptor(value: unknown): Result<PayloadFileDescriptor> {
  if (!isRecord(value)) return invalidManifest("files");
  const unknown = unknownFields(value, ["path", "sha256", "bytes", "mode"]);
  if (unknown.length > 0) return failure(unknown[0] as Diagnostic, ...unknown.slice(1));
  const path = typeof value["path"] === "string" ? parseRelativePayloadPath(value["path"]) : invalidManifest("files.path");
  const digest = typeof value["sha256"] === "string" ? parseSha256(value["sha256"]) : invalidManifest("files.sha256");
  const mode = typeof value["mode"] === "number" ? parsePortableFileMode(value["mode"]) : invalidManifest("files.mode");
  const bytes = value["bytes"];
  const diagnostics = [path, digest, mode].flatMap((result) => result.ok ? [] : result.diagnostics);
  if (!Number.isSafeInteger(bytes) || (typeof bytes === "number" && bytes < 0)) {
    diagnostics.push(diagnostic(compilerDiagnosticCodes.manifestInvalid, "Payload byte length must be a non-negative safe integer.", "files.bytes"));
  }
  if (diagnostics.length > 0) return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  if (!path.ok || !digest.ok || !mode.ok || typeof bytes !== "number") return invalidManifest("files");
  return success({ path: path.value, sha256: digest.value, bytes, mode: mode.value });
}

function invalidManifest(path: string): Result<never> {
  return failure(
    diagnostic(compilerDiagnosticCodes.manifestInvalid, "Bundle manifest field is invalid.", path),
  );
}

function unknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): readonly Diagnostic[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort(compareStrings)
    .map((key) =>
      diagnostic(
        compilerDiagnosticCodes.manifestUnknownField,
        `Unknown bundle manifest field "${key}".`,
        key,
      ),
    );
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort(compareStrings)
    .reduce<Record<string, JsonValue>>((acc, key) => {
      const entry = value[key];
      return entry === undefined ? acc : { ...acc, [key]: sortJson(entry as JsonValue) };
    }, {});
}

function comparePayloadFiles(left: PayloadFile, right: PayloadFile): number {
  return compareStrings(left.path, right.path);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isLexicallySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || compareStrings(values[index - 1] as string, value) <= 0);
}

function diagnostic(
  code: CompilerDiagnosticCode,
  message: string,
  path?: string,
): Diagnostic {
  return {
    severity: "error",
    code,
    message,
    ...(path === undefined ? {} : { path }),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
