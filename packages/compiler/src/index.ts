import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  isPathInside,
  loadPluginRoot,
  resolveContained,
  type Diagnostic,
  type PluginInspection,
  type PluginManifest,
  type PluginMcpServer,
} from "@agent-plugins/core";

/*
 * Compiler and adapter contracts intentionally live outside portable core. The
 * filesystem imports above are used only by the release-time compiler effect
 * boundary; adapter contract operations remain pure values.
 */

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

export interface VendorAdapter {
  readonly vendor: VendorId;
  readonly adapterVersion: string;
  readonly vendorSchemaVersion: string;
  readonly compile: (plugin: CanonicalPlugin) => Result<VendorBundleDraft>;
  readonly validate: (bundle: VendorBundle) => readonly Diagnostic[];
  readonly planInstallation: (
    bundle: VendorBundle,
    target: InstallTarget,
  ) => Result<InstallPlan>;
}

export type VendorAdapterRegistry = Readonly<Record<VendorId, VendorAdapter>>;

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

export interface CompilePluginInput {
  readonly source: string;
  readonly vendor: VendorId;
  readonly output: string;
}

export interface VerifyShippedPayloadInput {
  readonly source: string;
  readonly vendor: VendorId;
  readonly shipped: string;
}

export interface VendorCompiler {
  readonly compilePlugin: (input: CompilePluginInput) => CompileResult;
  readonly verifyShippedPayload: (
    input: VerifyShippedPayloadInput,
  ) => VerificationResult;
}

export interface CompilerTestHooks {
  readonly afterStaging?: () => void;
  readonly afterPriorBackup?: () => void;
}

export const BUNDLE_MANIFEST_FILE = "bundle.json" as const;
export const BUNDLE_PAYLOAD_DIRECTORY = "payload" as const;
export const CANONICAL_DISTRIBUTION_EXTENSION = "org.agent-plugins.distribution" as const;

export const compilerDiagnosticCodes = Object.freeze({
  vendorUnsupported: "adapter.vendor.unsupported",
  adapterInvalid: "adapter.contract.invalid",
  adapterMissing: "adapter.registry.missing",
  adapterDuplicate: "adapter.registry.duplicate",
  canonicalInvalid: "canonical.source.invalid",
  canonicalReadFailed: "canonical.source.read_failed",
  canonicalDistributionInvalid: "canonical.distribution.invalid",
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
  bundleUnreadable: "bundle.unreadable",
  bundleEntryInvalid: "bundle.entry.invalid",
  identityInvalid: "bundle.identity.invalid",
  adapterVersionInvalid: "adapter.version.invalid",
  planInvalid: "install.preflight.plan.invalid",
  planSourceMissing: "install.preflight.plan.source_missing",
  planSourceDuplicate: "install.preflight.plan.source_duplicate",
  planDestinationDuplicate: "install.preflight.plan.destination_duplicate",
  planOrderInvalid: "install.preflight.plan.order_invalid",
  compilerOutputInvalid: "compiler.output.invalid",
  compilerStageFailed: "compiler.stage.failed",
  compilerReplaceFailed: "compiler.replace.failed",
  compilerRestoreFailed: "compiler.restore.failed",
  driftManifest: "bundle.drift.manifest",
  driftPath: "bundle.drift.path",
  driftContent: "bundle.drift.content",
  driftMode: "bundle.drift.mode",
} as const);

export const PORTABLE_FILE_MODES = Object.freeze({
  regular: 0o644,
  executable: 0o755,
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

export function canonicalMarkdown(value: string): string {
  return canonicalText(value);
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

export function createJsonPayloadFile(input: {
  readonly path: string;
  readonly value: JsonValue;
  readonly mode?: number;
}): Result<PayloadFile> {
  return createPayloadFile({
    path: input.path,
    content: stableJson(input.value),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
  });
}

export function createMarkdownPayloadFile(input: {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
}): Result<PayloadFile> {
  return createPayloadFile({
    path: input.path,
    content: canonicalMarkdown(input.content),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
  });
}

export function formatPayloadPath(
  first: string,
  ...rest: readonly string[]
): Result<RelativePayloadPath> {
  return parseRelativePayloadPath([first, ...rest].join("/"));
}

export function sortPayloadFiles(
  files: readonly PayloadFile[],
): readonly PayloadFile[] {
  return Object.freeze([...files].sort(comparePayloadFiles));
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
  const files = sortPayloadFiles(draft.files);
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

export function createVendorAdapterRegistry(
  adapters: readonly unknown[],
): Result<VendorAdapterRegistry> {
  const parsed = adapters.map(parseVendorAdapter);
  const invalid = parsed.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (invalid.length > 0) {
    return failure(invalid[0] as Diagnostic, ...invalid.slice(1));
  }

  const valid = parsed.flatMap((result) => result.ok ? [result.value] : []);
  const duplicates = VENDOR_IDS.flatMap((vendor) =>
    valid.filter((adapter) => adapter.vendor === vendor).length > 1
      ? [
          diagnostic(
            compilerDiagnosticCodes.adapterDuplicate,
            `Adapter registry contains more than one ${vendor} adapter.`,
            vendor,
          ),
        ]
      : [],
  );
  const missing = VENDOR_IDS.flatMap((vendor) =>
    valid.some((adapter) => adapter.vendor === vendor)
      ? []
      : [
          diagnostic(
            compilerDiagnosticCodes.adapterMissing,
            `Adapter registry requires exactly one ${vendor} adapter.`,
            vendor,
          ),
        ],
  );
  const diagnostics = [...duplicates, ...missing];
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }

  const find = (vendor: VendorId): VendorAdapter =>
    valid.find((adapter) => adapter.vendor === vendor) as VendorAdapter;
  return success(
    Object.freeze({
      claude: find("claude"),
      codex: find("codex"),
      cursor: find("cursor"),
    }),
  );
}

export function getVendorAdapter(
  registry: VendorAdapterRegistry,
  vendor: VendorId,
): VendorAdapter {
  return registry[vendor];
}

export function listVendorAdapters(): readonly VendorId[] {
  return VENDOR_IDS;
}

export function createVendorCompiler(
  registry: VendorAdapterRegistry,
  hooks: CompilerTestHooks = {},
): VendorCompiler {
  return Object.freeze({
    compilePlugin: (input: CompilePluginInput) => compilePlugin(input, registry, hooks),
    verifyShippedPayload: (input: VerifyShippedPayloadInput) =>
      verifyShippedPayload(input, registry, hooks),
  });
}

export function compilePlugin(
  input: CompilePluginInput,
  registry: VendorAdapterRegistry,
  hooks: CompilerTestHooks = {},
): CompileResult {
  const vendor = parseVendorId(input.vendor);
  if (!vendor.ok) return { ok: false, diagnostics: vendor.diagnostics };
  return compileVendorPayload(input, getVendorAdapter(registry, vendor.value), hooks);
}

export function compileVendorPayload(
  input: CompilePluginInput,
  adapter: VendorAdapter,
  hooks: CompilerTestHooks = {},
): CompileResult {
  const vendor = parseVendorId(input.vendor);
  if (!vendor.ok) return { ok: false, diagnostics: vendor.diagnostics };
  if (vendor.value !== adapter.vendor) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          compilerDiagnosticCodes.adapterInvalid,
          "Explicit compiler vendor must match the selected adapter.",
          vendor.value,
        ),
      ],
    };
  }

  const source = resolve(input.source);
  const output = resolve(input.output);
  if (isPathInside(source, output) || isPathInside(output, source)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          compilerDiagnosticCodes.compilerOutputInvalid,
          "Compiler source and output directories must not overlap.",
          output,
        ),
      ],
    };
  }

  const canonical = normalizeCanonicalPlugin(source);
  if (!canonical.ok) return { ok: false, diagnostics: canonical.diagnostics };

  try {
    const compiled = adapter.compile(canonical.value);
    if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics };
    const identityDiagnostics = validateAdapterDraft(adapter, canonical.value, compiled.value);
    if (identityDiagnostics.length > 0) {
      return { ok: false, diagnostics: identityDiagnostics };
    }

    const finalized = finalizeVendorBundle(compiled.value);
    if (!finalized.ok) return { ok: false, diagnostics: finalized.diagnostics };
    const adapterDiagnostics = adapter.validate(finalized.value);
    if (adapterDiagnostics.length > 0) {
      return { ok: false, diagnostics: adapterDiagnostics };
    }

    const materialized = materializeVendorBundle(finalized.value, output, hooks);
    return materialized.ok
      ? { ok: true, bundle: finalized.value.manifest, output: materialized.value }
      : { ok: false, diagnostics: materialized.diagnostics };
  } catch {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          compilerDiagnosticCodes.adapterInvalid,
          "Adapter compilation failed unexpectedly at the release compiler boundary.",
          vendor.value,
        ),
      ],
    };
  }
}

export function verifyShippedPayload(
  input: VerifyShippedPayloadInput,
  registry: VendorAdapterRegistry,
  hooks: CompilerTestHooks = {},
): VerificationResult {
  const vendor = parseVendorId(input.vendor);
  if (!vendor.ok) return { ok: false, diagnostics: vendor.diagnostics };
  return verifyVendorPayload(input, getVendorAdapter(registry, vendor.value), hooks);
}

export function verifyVendorPayload(
  input: VerifyShippedPayloadInput,
  adapter: VendorAdapter,
  hooks: CompilerTestHooks = {},
): VerificationResult {
  let temporaryRoot: string;
  try {
    temporaryRoot = mkdtempSync(join(tmpdir(), "agent-plugin-verify-"));
  } catch {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          compilerDiagnosticCodes.compilerStageFailed,
          "Isolated payload verification workspace could not be created.",
        ),
      ],
    };
  }
  const generatedRoot = join(temporaryRoot, "generated");
  try {
    const compiled = compileVendorPayload(
      { source: input.source, vendor: input.vendor, output: generatedRoot },
      adapter,
      hooks,
    );
    if (!compiled.ok) return compiled;

    const generated = readVendorBundle(generatedRoot);
    if (!generated.ok) return { ok: false, diagnostics: generated.diagnostics };
    const shipped = readVendorBundle(input.shipped);
    if (!shipped.ok) return { ok: false, diagnostics: shipped.diagnostics };
    const drift = compareVendorBundles(generated.value, shipped.value);
    return drift.length === 0
      ? {
          ok: true,
          sourceDigest: generated.value.manifest.sourceDigest,
          payloadDigest: generated.value.manifest.payloadDigest,
        }
      : { ok: false, diagnostics: drift };
  } finally {
    removeGeneratedPath(temporaryRoot);
  }
}

export function normalizeCanonicalPlugin(source: string): Result<CanonicalPlugin> {
  const root = resolve(source);
  let inspection: PluginInspection;
  try {
    inspection = loadPluginRoot(root);
  } catch {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.canonicalReadFailed,
        "Canonical plugin source could not be inspected.",
        root,
      ),
    );
  }

  const errors = inspection.diagnostics.filter((entry) => entry.severity === "error");
  if (errors.length > 0) return failure(errors[0] as Diagnostic, ...errors.slice(1));
  if (inspection.manifest === undefined) {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.canonicalInvalid,
        "Canonical plugin inspection did not produce a manifest.",
        "plugin.json",
      ),
    );
  }

  const skills = readCanonicalSkills(root, inspection);
  if (!skills.ok) return skills;
  const distribution = parseCanonicalDistribution(inspection.manifest);
  if (!distribution.ok) return distribution;
  const mcpServers = [...(inspection.mcpServers ?? [])].sort(compareMcpServers);
  const withoutDigest = {
    manifest: inspection.manifest,
    skills: skills.value,
    mcpServers,
    rules: distribution.value.rules,
    hookIntents: distribution.value.hookIntents,
    distribution: distribution.value.distribution,
  };
  const sourceJson = toJsonValue(withoutDigest);
  if (!sourceJson.ok) return sourceJson;

  return success({
    root,
    ...withoutDigest,
    sourceDigest: sha256(stableJson(sourceJson.value)),
  });
}

export function readVendorBundle(bundleRoot: string): Result<VendorBundle> {
  const root = resolve(bundleRoot);
  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.bundleUnreadable,
          "Vendor bundle root must be a real directory.",
          root,
        ),
      );
    }
    const entries = readdirSync(root).sort(compareStrings);
    if (entries.length !== 2 || entries[0] !== BUNDLE_MANIFEST_FILE || entries[1] !== BUNDLE_PAYLOAD_DIRECTORY) {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.bundleEntryInvalid,
          "Vendor bundle root must contain exactly bundle.json and payload/.",
          root,
        ),
      );
    }

    const manifestPath = join(root, BUNDLE_MANIFEST_FILE);
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.bundleEntryInvalid,
          "Bundle manifest must be a regular file.",
          BUNDLE_MANIFEST_FILE,
        ),
      );
    }
    const manifestJson = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    const manifest = parseVendorBundleManifest(manifestJson);
    if (!manifest.ok) return manifest;
    const files = readPayloadTree(join(root, BUNDLE_PAYLOAD_DIRECTORY));
    if (!files.ok) return files;
    const bundle = { manifest: manifest.value, files: files.value };
    const diagnostics = validateVendorBundle(bundle);
    return diagnostics.length === 0
      ? success(bundle)
      : failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  } catch {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.bundleUnreadable,
        "Vendor bundle could not be read as a closed generated artifact.",
        root,
      ),
    );
  }
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

interface ParsedCanonicalDistribution {
  readonly rules: readonly CanonicalRule[];
  readonly hookIntents: readonly CanonicalHookIntent[];
  readonly distribution: CanonicalDistribution;
}

function readCanonicalSkills(
  root: string,
  inspection: PluginInspection,
): Result<readonly CanonicalSkill[]> {
  const results = (inspection.skills ?? []).map((skill) => {
    const contained = resolveContained(root, skill.path);
    if (!contained.ok) return failure(contained.diagnostic);
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        readFileSync(contained.path),
      );
      return success({
        name: skill.name ?? basename(dirname(skill.path)),
        path: skill.path,
        ...(skill.description === undefined ? {} : { description: skill.description }),
        content: canonicalMarkdown(content),
      });
    } catch {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.canonicalReadFailed,
          "Canonical Skill content must be readable UTF-8 text.",
          skill.path,
        ),
      );
    }
  });
  const diagnostics = results.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  const skills = results.flatMap((result) => result.ok ? [result.value] : [])
    .sort((left, right) => compareStrings(left.path, right.path));
  const duplicate = duplicateDiagnostics(
    skills.map((skill) => skill.path),
    compilerDiagnosticCodes.canonicalInvalid,
    "Canonical Skill paths must be unique.",
  );
  return duplicate.length === 0
    ? success(Object.freeze(skills))
    : failure(duplicate[0] as Diagnostic, ...duplicate.slice(1));
}

function parseCanonicalDistribution(
  manifest: PluginManifest,
): Result<ParsedCanonicalDistribution> {
  const extension = manifest.extensions?.[CANONICAL_DISTRIBUTION_EXTENSION];
  if (extension === undefined) {
    return success({
      rules: Object.freeze([]),
      hookIntents: Object.freeze([]),
      distribution: {
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        compatibility: {
          bundleSchemaMajor: 1,
          allowDowngradeWithinMajor: false,
        },
      },
    });
  }
  if (!isRecord(extension)) return invalidCanonicalDistribution(CANONICAL_DISTRIBUTION_EXTENSION);
  const unknown = canonicalUnknownFields(extension, ["rules", "hookIntents", "compatibility"]);
  const rules = parseCanonicalRules(extension["rules"]);
  const hooks = parseCanonicalHookIntents(extension["hookIntents"]);
  const compatibility = parseCanonicalCompatibility(extension["compatibility"]);
  const diagnostics = [
    ...unknown,
    ...(rules.ok ? [] : rules.diagnostics),
    ...(hooks.ok ? [] : hooks.diagnostics),
    ...(compatibility.ok ? [] : compatibility.diagnostics),
  ];
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  if (!rules.ok || !hooks.ok || !compatibility.ok) {
    return invalidCanonicalDistribution(CANONICAL_DISTRIBUTION_EXTENSION);
  }
  return success({
    rules: rules.value,
    hookIntents: hooks.value,
    distribution: {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      compatibility: {
        bundleSchemaMajor: 1,
        allowDowngradeWithinMajor: compatibility.value,
      },
    },
  });
}

function parseCanonicalRules(value: unknown): Result<readonly CanonicalRule[]> {
  if (value === undefined) return success(Object.freeze([]));
  if (!Array.isArray(value)) return invalidCanonicalDistribution("rules");
  const results = value.map((entry, index) => parseCanonicalRule(entry, index));
  const diagnostics = results.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  const rules = results.flatMap((result) => result.ok ? [result.value] : [])
    .sort((left, right) => compareStrings(left.id, right.id));
  const duplicates = duplicateDiagnostics(
    rules.map((rule) => rule.id),
    compilerDiagnosticCodes.canonicalDistributionInvalid,
    "Canonical rule identifiers must be unique.",
  );
  return duplicates.length === 0
    ? success(Object.freeze(rules))
    : failure(duplicates[0] as Diagnostic, ...duplicates.slice(1));
}

function parseCanonicalRule(value: unknown, index: number): Result<CanonicalRule> {
  const path = `rules[${index}]`;
  if (!isRecord(value)) return invalidCanonicalDistribution(path);
  const unknown = canonicalUnknownFields(value, ["id", "description", "activation", "fileGlobs", "content"], path);
  const id = value["id"];
  const description = value["description"];
  const activation = value["activation"];
  const fileGlobs = value["fileGlobs"];
  const content = value["content"];
  const valid = typeof id === "string" && id.length > 0 &&
    (description === undefined || typeof description === "string") &&
    (activation === "always" || activation === "model-decides") &&
    Array.isArray(fileGlobs) && fileGlobs.every((entry) => typeof entry === "string") &&
    typeof content === "string";
  if (!valid || unknown.length > 0) {
    const diagnostics = [
      ...unknown,
      ...(valid ? [] : [canonicalDistributionDiagnostic("Canonical rule declaration is invalid.", path)]),
    ];
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  return success({
    id,
    ...(description === undefined ? {} : { description: description as string }),
    activation,
    fileGlobs: Object.freeze([...(fileGlobs as readonly string[])].sort(compareStrings)),
    content: canonicalMarkdown(content),
  });
}

function parseCanonicalHookIntents(
  value: unknown,
): Result<readonly CanonicalHookIntent[]> {
  if (value === undefined) return success(Object.freeze([]));
  if (!Array.isArray(value)) return invalidCanonicalDistribution("hookIntents");
  const results = value.map((entry, index) => parseCanonicalHookIntent(entry, index));
  const diagnostics = results.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  const hooks = results.flatMap((result) => result.ok ? [result.value] : [])
    .sort((left, right) => compareStrings(left.id, right.id));
  const duplicates = duplicateDiagnostics(
    hooks.map((hook) => hook.id),
    compilerDiagnosticCodes.canonicalDistributionInvalid,
    "Canonical hook intent identifiers must be unique.",
  );
  return duplicates.length === 0
    ? success(Object.freeze(hooks))
    : failure(duplicates[0] as Diagnostic, ...duplicates.slice(1));
}

function parseCanonicalHookIntent(
  value: unknown,
  index: number,
): Result<CanonicalHookIntent> {
  const path = `hookIntents[${index}]`;
  if (!isRecord(value)) return invalidCanonicalDistribution(path);
  const unknown = canonicalUnknownFields(
    value,
    ["id", "lifecycle", "toolKinds", "executable", "arguments", "timeoutSeconds"],
    path,
  );
  const id = value["id"];
  const lifecycle = value["lifecycle"];
  const toolKinds = value["toolKinds"];
  const executable = value["executable"];
  const args = value["arguments"];
  const timeout = value["timeoutSeconds"];
  const valid = typeof id === "string" && id.length > 0 &&
    isCanonicalHookLifecycle(lifecycle) &&
    Array.isArray(toolKinds) && toolKinds.every(isCanonicalToolKind) &&
    typeof executable === "string" && executable.length > 0 &&
    Array.isArray(args) && args.every((entry) => typeof entry === "string") &&
    (timeout === undefined || (Number.isSafeInteger(timeout) && typeof timeout === "number" && timeout > 0));
  if (!valid || unknown.length > 0) {
    const diagnostics = [
      ...unknown,
      ...(valid ? [] : [canonicalDistributionDiagnostic("Canonical hook intent declaration is invalid.", path)]),
    ];
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  return success({
    id,
    lifecycle,
    toolKinds: Object.freeze([...(toolKinds as readonly CanonicalToolKind[])].sort(compareStrings)),
    executable,
    arguments: Object.freeze([...(args as readonly string[])]),
    ...(timeout === undefined ? {} : { timeoutSeconds: timeout as number }),
  });
}

function parseCanonicalCompatibility(value: unknown): Result<boolean> {
  if (value === undefined) return success(false);
  if (!isRecord(value)) return invalidCanonicalDistribution("compatibility");
  const unknown = canonicalUnknownFields(value, ["allowDowngradeWithinMajor"], "compatibility");
  const allow = value["allowDowngradeWithinMajor"];
  if (unknown.length > 0 || (allow !== undefined && typeof allow !== "boolean")) {
    const diagnostics = [
      ...unknown,
      ...(allow === undefined || typeof allow === "boolean"
        ? []
        : [canonicalDistributionDiagnostic("Canonical compatibility declaration is invalid.", "compatibility")]),
    ];
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  return success(allow ?? false);
}

function validateAdapterDraft(
  adapter: VendorAdapter,
  plugin: CanonicalPlugin,
  draft: VendorBundleDraft,
): readonly Diagnostic[] {
  return draft.plugin.name === plugin.manifest.name &&
      draft.plugin.version === plugin.manifest.version &&
      draft.vendor === adapter.vendor &&
      draft.adapter.version === adapter.adapterVersion &&
      draft.adapter.vendorSchemaVersion === adapter.vendorSchemaVersion &&
      draft.sourceDigest === plugin.sourceDigest
    ? []
    : [
        diagnostic(
          compilerDiagnosticCodes.adapterInvalid,
          "Adapter output identity and provenance must match its canonical input and registered metadata.",
          adapter.vendor,
        ),
      ];
}

function materializeVendorBundle(
  bundle: VendorBundle,
  output: string,
  hooks: CompilerTestHooks,
): Result<string> {
  const existing = pathKind(output);
  if (existing === "file" || existing === "symlink" || existing === "other") {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.compilerOutputInvalid,
        "Compiler output must be missing or a real directory.",
        output,
      ),
    );
  }
  let stage: string | undefined;
  try {
    mkdirSync(dirname(output), { recursive: true });
    stage = mkdtempSync(join(dirname(output), `.${basename(output)}.stage-`));
    writeVendorBundle(stage, bundle);
    const staged = readVendorBundle(stage);
    if (!staged.ok || compareVendorBundles(bundle, staged.value).length > 0) {
      return staged.ok
        ? failure(diagnostic(compilerDiagnosticCodes.compilerStageFailed, "Staged bundle verification failed.", output))
        : failure(staged.diagnostics[0], ...staged.diagnostics.slice(1));
    }
    hooks.afterStaging?.();
    return replaceStagedOutput(stage, output, bundle, hooks);
  } catch {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.compilerStageFailed,
        "Vendor bundle staging failed before output replacement.",
        output,
      ),
    );
  } finally {
    if (stage !== undefined) removeGeneratedPath(stage);
  }
}

function writeVendorBundle(root: string, bundle: VendorBundle): void {
  chmodSync(root, 0o755);
  const manifestJson = toJsonValue(bundle.manifest);
  if (!manifestJson.ok) throw new Error("invalid manifest JSON value");
  const manifestPath = join(root, BUNDLE_MANIFEST_FILE);
  writeFileSync(manifestPath, stableJson(manifestJson.value), { flag: "wx", mode: 0o644 });
  chmodSync(manifestPath, 0o644);
  const payloadRoot = join(root, BUNDLE_PAYLOAD_DIRECTORY);
  mkdirSync(payloadRoot, { mode: 0o755 });
  for (const file of bundle.files) {
    const destination = join(payloadRoot, ...file.path.split("/"));
    mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    writeFileSync(destination, file.content, { flag: "wx", mode: file.mode });
    chmodSync(destination, file.mode);
  }
}

function replaceStagedOutput(
  stage: string,
  output: string,
  expected: VendorBundle,
  hooks: CompilerTestHooks,
): Result<string> {
  let backup: string | undefined;
  let priorMoved = false;
  let stageMoved = false;
  try {
    if (pathKind(output) === "directory") {
      backup = mkdtempSync(join(dirname(output), `.${basename(output)}.backup-`));
      rmSync(backup, { recursive: true });
      renameSync(output, backup);
      priorMoved = true;
      hooks.afterPriorBackup?.();
    }
    renameSync(stage, output);
    stageMoved = true;
    const installed = readVendorBundle(output);
    if (!installed.ok || compareVendorBundles(expected, installed.value).length > 0) {
      throw new Error("output verification failed");
    }
    if (backup !== undefined) removeGeneratedPath(backup);
    return success(output);
  } catch {
    if (stageMoved) removeGeneratedPath(output);
    if (priorMoved && backup !== undefined) {
      try {
        renameSync(backup, output);
      } catch {
        return failure(
          diagnostic(
            compilerDiagnosticCodes.compilerRestoreFailed,
            "Compiler output replacement failed and the prior output could not be restored automatically.",
            backup,
          ),
        );
      }
    }
    return failure(
      diagnostic(
        compilerDiagnosticCodes.compilerReplaceFailed,
        "Compiler output replacement failed; the prior output was preserved.",
        output,
      ),
    );
  }
}

function readPayloadTree(payloadRoot: string): Result<readonly PayloadFile[]> {
  try {
    const stat = lstatSync(payloadRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.bundleEntryInvalid,
          "Bundle payload must be a real directory.",
          BUNDLE_PAYLOAD_DIRECTORY,
        ),
      );
    }
    return readPayloadDirectory(payloadRoot, []);
  } catch {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.bundleUnreadable,
        "Bundle payload directory could not be read.",
        BUNDLE_PAYLOAD_DIRECTORY,
      ),
    );
  }
}

function readPayloadDirectory(
  directory: string,
  segments: readonly string[],
): Result<readonly PayloadFile[]> {
  const results = readdirSync(directory).sort(compareStrings).map((entry) => {
    const absolute = join(directory, entry);
    const relativeSegments = [...segments, entry];
    const path = relativeSegments.join("/");
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.bundleEntryInvalid,
          "Symlink payload entries are forbidden.",
          path,
        ),
      );
    }
    if (stat.isDirectory()) return readPayloadDirectory(absolute, relativeSegments);
    if (!stat.isFile()) {
      return failure(
        diagnostic(
          compilerDiagnosticCodes.bundleEntryInvalid,
          "Payload entries must be regular files or directories.",
          path,
        ),
      );
    }
    const file = createPayloadFile({
      path,
      content: readFileSync(absolute),
      mode: stat.mode & 0o777,
    });
    return file.ok ? success([file.value]) : file;
  });
  const diagnostics = results.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  return success(Object.freeze(results.flatMap((result) => result.ok ? result.value : [])));
}

function compareVendorBundles(
  expected: VendorBundle,
  actual: VendorBundle,
): readonly Diagnostic[] {
  const expectedManifest = toJsonValue(expected.manifest);
  const actualManifest = toJsonValue(actual.manifest);
  const manifestEqual = expectedManifest.ok && actualManifest.ok &&
    stableJson(expectedManifest.value) === stableJson(actualManifest.value);
  const expectedPaths = expected.files.map((file) => file.path);
  const actualPaths = actual.files.map((file) => file.path);
  const diagnostics: Diagnostic[] = manifestEqual
    ? []
    : [diagnostic(compilerDiagnosticCodes.driftManifest, "Generated and shipped bundle manifests differ.")];
  if (expectedPaths.length !== actualPaths.length ||
      expectedPaths.some((path, index) => path !== actualPaths[index])) {
    diagnostics.push(
      diagnostic(
        compilerDiagnosticCodes.driftPath,
        "Generated and shipped payload paths differ.",
      ),
    );
  }
  const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
  for (const expectedFile of expected.files) {
    const actualFile = actualByPath.get(expectedFile.path);
    if (actualFile === undefined) continue;
    if (expectedFile.mode !== actualFile.mode) {
      diagnostics.push(
        diagnostic(
          compilerDiagnosticCodes.driftMode,
          "Generated and shipped payload file modes differ.",
          expectedFile.path,
        ),
      );
    }
    if (!Buffer.from(expectedFile.content).equals(Buffer.from(actualFile.content))) {
      diagnostics.push(
        diagnostic(
          compilerDiagnosticCodes.driftContent,
          "Generated and shipped payload bytes differ.",
          expectedFile.path,
        ),
      );
    }
  }
  return diagnostics;
}

function toJsonValue(value: unknown, path = "value"): Result<JsonValue> {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return success(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return success(value);
  if (Array.isArray(value)) {
    const results = value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`));
    const diagnostics = results.flatMap((result) => result.ok ? [] : result.diagnostics);
    return diagnostics.length === 0
      ? success(results.flatMap((result) => result.ok ? [result.value] : []))
      : failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  if (isRecord(value)) {
    const json: Record<string, JsonValue> = {};
    const diagnostics: Diagnostic[] = [];
    for (const key of Object.keys(value).sort(compareStrings)) {
      const entry = value[key];
      if (entry === undefined) continue;
      const parsed = toJsonValue(entry, `${path}.${key}`);
      if (parsed.ok) json[key] = parsed.value;
      else diagnostics.push(...parsed.diagnostics);
    }
    if (diagnostics.length > 0) {
      return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
    }
    return success(json);
  }
  return failure(
    diagnostic(
      compilerDiagnosticCodes.canonicalInvalid,
      "Canonical data must contain only finite JSON values.",
      path,
    ),
  );
}

function compareMcpServers(left: PluginMcpServer, right: PluginMcpServer): number {
  const leftJson = toJsonValue(left);
  const rightJson = toJsonValue(right);
  return compareStrings(
    leftJson.ok ? stableJson(leftJson.value) : "",
    rightJson.ok ? stableJson(rightJson.value) : "",
  );
}

function canonicalUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  parent: string = CANONICAL_DISTRIBUTION_EXTENSION,
): readonly Diagnostic[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort(compareStrings)
    .map((key) =>
      canonicalDistributionDiagnostic(
        `Unknown canonical distribution field "${key}".`,
        `${parent}.${key}`,
      ),
    );
}

function invalidCanonicalDistribution(path: string): Result<never> {
  return failure(
    canonicalDistributionDiagnostic("Canonical distribution declaration is invalid.", path),
  );
}

function canonicalDistributionDiagnostic(message: string, path: string): Diagnostic {
  return diagnostic(compilerDiagnosticCodes.canonicalDistributionInvalid, message, path);
}

function isCanonicalHookLifecycle(value: unknown): value is CanonicalHookLifecycle {
  return value === "session-start" || value === "session-end" || value === "before-tool" ||
    value === "after-tool" || value === "before-prompt" || value === "stop";
}

function isCanonicalToolKind(value: unknown): value is CanonicalToolKind {
  return value === "shell" || value === "file-read" || value === "file-write" || value === "mcp";
}

function pathKind(path: string): "missing" | "directory" | "file" | "symlink" | "other" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

function removeGeneratedPath(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort after the generated artifact has been verified.
  }
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

function parseVendorAdapter(value: unknown): Result<VendorAdapter> {
  if (!isRecord(value)) {
    return failure(
      diagnostic(
        compilerDiagnosticCodes.adapterInvalid,
        "Vendor adapter must be an immutable contract object.",
      ),
    );
  }

  const vendor = typeof value["vendor"] === "string"
    ? parseVendorId(value["vendor"])
    : failure(
        diagnostic(
          compilerDiagnosticCodes.adapterInvalid,
          "Vendor adapter must declare a supported vendor.",
          "vendor",
        ),
      );
  const adapterVersion = value["adapterVersion"];
  const vendorSchemaVersion = value["vendorSchemaVersion"];
  const compile = value["compile"];
  const validate = value["validate"];
  const planInstallation = value["planInstallation"];
  const diagnostics = [
    ...(vendor.ok ? [] : vendor.diagnostics),
    ...(typeof adapterVersion === "string" && adapterVersion.length > 0
      ? []
      : [diagnostic(compilerDiagnosticCodes.adapterInvalid, "Adapter version must be non-empty.", "adapterVersion")]),
    ...(typeof vendorSchemaVersion === "string" && vendorSchemaVersion.length > 0
      ? []
      : [diagnostic(compilerDiagnosticCodes.adapterInvalid, "Vendor schema version must be non-empty.", "vendorSchemaVersion")]),
    ...(typeof compile === "function"
      ? []
      : [diagnostic(compilerDiagnosticCodes.adapterInvalid, "Adapter compile operation is required.", "compile")]),
    ...(typeof validate === "function"
      ? []
      : [diagnostic(compilerDiagnosticCodes.adapterInvalid, "Adapter validate operation is required.", "validate")]),
    ...(typeof planInstallation === "function"
      ? []
      : [diagnostic(compilerDiagnosticCodes.adapterInvalid, "Adapter installation-plan operation is required.", "planInstallation")]),
  ];
  if (diagnostics.length > 0) {
    return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  }
  if (!vendor.ok || typeof adapterVersion !== "string" || typeof vendorSchemaVersion !== "string" ||
      typeof compile !== "function" || typeof validate !== "function" || typeof planInstallation !== "function") {
    return failure(diagnostic(compilerDiagnosticCodes.adapterInvalid, "Vendor adapter contract is invalid."));
  }

  return success(
    Object.freeze({
      vendor: vendor.value,
      adapterVersion,
      vendorSchemaVersion,
      compile: compile as VendorAdapter["compile"],
      validate: validate as VendorAdapter["validate"],
      planInstallation: planInstallation as VendorAdapter["planInstallation"],
    }),
  );
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
