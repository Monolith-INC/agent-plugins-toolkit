import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { Diagnostic } from "@agent-plugins/core";
import { resolveContained } from "@agent-plugins/core";
import {
  BUNDLE_SCHEMA_VERSION,
  parsePortableFileMode,
  parseRelativePayloadPath,
  parseVendorId,
  sha256,
  stableJson,
  validateInstallPlan,
  validateVendorBundle,
  type InstallPlan,
  type InstallResult,
  type InstalledBundleRecord,
  type JournalEntry,
  type JsonValue,
  type PayloadFile,
  type PortableFileMode,
  type RelativePayloadPath,
  type Result,
  type Sha256,
  type VendorAdapter,
  type VendorBundle,
  type VendorId,
} from "@agent-plugins/compiler";

export const INSTALLER_VERSION = "1.0.0" as const;
export const INSTALL_METADATA_DIRECTORY = ".agent-plugins" as const;

export interface InstallVendorBundleInput {
  readonly bundle: VendorBundle;
  readonly adapter: VendorAdapter;
  readonly target: { readonly root: string };
}

export interface InstallerMutationPoint {
  readonly index: number;
  readonly action: "install" | "remove" | "restore";
  readonly path: string;
}

export interface InstallerTestHooks {
  readonly beforeMutation?: (point: InstallerMutationPoint) => void;
  readonly beforeRollbackMutation?: (point: InstallerMutationPoint) => void;
}

export type VendorInstaller = (input: InstallVendorBundleInput) => InstallResult;

export function installVendorBundle(input: InstallVendorBundleInput): InstallResult {
  return runInstall(input, {});
}

export function createVendorInstaller(hooks: InstallerTestHooks): VendorInstaller {
  return (input) => runInstall(input, hooks);
}

type Preflight = {
  readonly targetRoot: string;
  readonly plan: InstallPlan;
  readonly existingRecord?: InstalledBundleRecord;
  readonly recordPath: string;
  readonly recordRelative: RelativePayloadPath;
  readonly stale: readonly InstalledBundleRecord["installedFiles"][number][];
  readonly changed: readonly InstallPlan["writes"][number][];
};

type Transaction = {
  readonly root: string;
  readonly stage: string;
  readonly backup: string;
  readonly journal: string;
  readonly lock: string;
  readonly createdDirectories: string[];
  readonly entries: JournalEntry[];
};

function runInstall(input: InstallVendorBundleInput, hooks: InstallerTestHooks): InstallResult {
  const initialPreflight = preflightInstall(input);
  if (!initialPreflight.ok) return { kind: "failed-before-mutation", diagnostics: initialPreflight.diagnostics };

  const transaction = beginTransaction(initialPreflight.value.targetRoot);
  if (!transaction.ok) return { kind: "failed-before-mutation", diagnostics: transaction.diagnostics };
  try {
    const lockedPreflight = preflightInstall(input);
    if (!lockedPreflight.ok) {
      finishTransaction(transaction.value, false);
      return { kind: "failed-before-mutation", diagnostics: lockedPreflight.diagnostics };
    }
    const preflight = lockedPreflight.value;
    if (preflight.changed.length === 0 && preflight.stale.length === 0 &&
        preflight.existingRecord?.payloadDigest === input.bundle.manifest.payloadDigest) {
      finishTransaction(transaction.value, false);
      return { kind: "unchanged", changedPaths: 0, record: preflight.existingRecord };
    }

    const staged = stagePayload(input.bundle, preflight, transaction.value);
    if (!staged.ok) {
      finishTransaction(transaction.value, false);
      return { kind: "failed-before-mutation", diagnostics: staged.diagnostics };
    }

    const record = createInstalledRecord(input.bundle, preflight.plan);
    const committed = commitTransaction(input.bundle, preflight, transaction.value, record, hooks);
    if (!committed.ok) return rollbackResult(transaction.value, committed.diagnostics, hooks);

    const verified = verifyInstalledState(preflight.targetRoot, preflight.recordPath, record);
    if (!verified.ok) return rollbackResult(transaction.value, verified.diagnostics, hooks);

    finishTransaction(transaction.value, true);
    return {
      kind: "installed",
      changedPaths: preflight.changed.length + preflight.stale.length,
      record,
    };
  } catch (error) {
    const diagnostics = [installDiagnostic("install.commit.failed", errorMessage(error))];
    return transaction.value.entries.length === 0
      ? (finishTransaction(transaction.value, false), { kind: "failed-before-mutation", diagnostics })
      : rollbackResult(transaction.value, diagnostics, hooks);
  }
}

function preflightInstall(input: InstallVendorBundleInput): Result<Preflight> {
  const diagnostics: Diagnostic[] = [...validateVendorBundle(input.bundle)];
  if (input.adapter.vendor !== input.bundle.manifest.vendor || input.adapter.adapterVersion !== input.bundle.manifest.adapter.version) {
    diagnostics.push(installDiagnostic("install.preflight.adapter_mismatch", "Adapter identity does not match the bundle."));
  } else {
    diagnostics.push(...input.adapter.validate(input.bundle));
  }
  const planned = diagnostics.length === 0
    ? input.adapter.planInstallation(input.bundle, input.target)
    : failureResult<InstallPlan>(diagnostics);
  if (!planned.ok) diagnostics.push(...planned.diagnostics);
  else diagnostics.push(...validateInstallPlan(planned.value, input.bundle));

  const targetRoot = resolve(input.target.root);
  try {
    const stat = lstatSync(targetRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) diagnostics.push(installDiagnostic("install.preflight.target.invalid", "Installation target must be a real directory.", targetRoot));
    else accessSync(targetRoot, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    diagnostics.push(installDiagnostic("install.preflight.target.unusable", "Installation target is not readable and writable.", targetRoot));
  }

  const recordRelative = relativePath(`${INSTALL_METADATA_DIRECTORY}/installed/${input.bundle.manifest.vendor}-${sha256(input.bundle.manifest.plugin.name).slice(0, 16)}.json`);
  const recordPath = join(targetRoot, ...recordRelative.split("/"));
  const records = diagnostics.length === 0 ? readInstalledRecords(targetRoot) : successResult<readonly InstalledBundleRecord[]>([]);
  if (!records.ok) diagnostics.push(...records.diagnostics);
  const existingRecord = records.ok
    ? records.value.find((record) => record.plugin === input.bundle.manifest.plugin.name && record.vendor === input.bundle.manifest.vendor)
    : undefined;
  const ownerByPath = new Map<string, InstalledBundleRecord>();
  if (records.ok) {
    for (const record of records.value) for (const file of record.installedFiles) ownerByPath.set(file.path, record);
  }

  if (planned.ok && diagnostics.length === 0) {
    for (const write of planned.value.writes) {
      diagnostics.push(...validateTargetPath(targetRoot, write.destination));
      const destination = join(targetRoot, ...write.destination.split("/"));
      if (!existsSync(destination)) continue;
      const owner = ownerByPath.get(write.destination);
      if (owner === undefined || owner !== existingRecord) {
        diagnostics.push(installDiagnostic("install.preflight.collision", "Destination is not owned by this installed plugin.", write.destination));
      }
    }
    if (existingRecord !== undefined) {
      for (const file of existingRecord.installedFiles) {
        const actual = inspectInstalledFile(targetRoot, file.path);
        if (!actual.ok || actual.value.sha256 !== file.sha256 || actual.value.mode !== file.mode) {
          diagnostics.push(installDiagnostic("install.preflight.owned_drift", "Previously installed file was modified or removed.", file.path));
        }
      }
    }
  }

  if (diagnostics.length > 0 || !planned.ok) return failureResult(diagnostics);
  const nextPaths = new Set(planned.value.writes.map((write) => write.destination));
  const stale = existingRecord?.installedFiles.filter((file) => !nextPaths.has(file.path)) ?? [];
  const changed = planned.value.writes.filter((write) => {
    const source = input.bundle.files.find((file) => file.path === write.source) as PayloadFile;
    const actual = inspectInstalledFile(targetRoot, write.destination);
    return !actual.ok || actual.value.sha256 !== source.sha256 || actual.value.mode !== write.mode;
  });
  return successResult({
    targetRoot,
    plan: planned.value,
    ...(existingRecord === undefined ? {} : { existingRecord }),
    recordPath,
    recordRelative,
    stale,
    changed,
  });
}

function validateTargetPath(targetRoot: string, path: RelativePayloadPath): readonly Diagnostic[] {
  const contained = resolveContained(targetRoot, path);
  if (!contained.ok) return [installDiagnostic("install.preflight.path_escape", "Installation destination escapes the target.", path)];
  let cursor = targetRoot;
  for (const segment of path.split("/").slice(0, -1)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) continue;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return [installDiagnostic("install.preflight.symlink", "Installation destination has an unsafe ancestor.", path)];
  }
  if (existsSync(contained.path)) {
    const stat = lstatSync(contained.path);
    if (stat.isSymbolicLink() || !stat.isFile()) return [installDiagnostic("install.preflight.destination.invalid", "Installation destination must be a regular file.", path)];
  }
  return [];
}

function beginTransaction(targetRoot: string): Result<Transaction> {
  const createdDirectories: string[] = [];
  const metadata = join(targetRoot, INSTALL_METADATA_DIRECTORY);
  const transactions = join(metadata, "transactions");
  const installed = join(metadata, "installed");
  const lock = join(metadata, "install.lock");
  let ownsLock = false;
  try {
    for (const directory of [metadata, transactions, installed]) ensureDirectory(directory, createdDirectories, 0o700);
    const handle = openSync(lock, "wx", 0o600);
    ownsLock = true;
    writeSync(handle, `${process.pid}\n`);
    fsyncSync(handle);
    closeSync(handle);
    const root = mkdtempSync(join(transactions, "tx-"));
    chmodSync(root, 0o700);
    const stage = join(root, "stage");
    const backup = join(root, "backup");
    mkdirSync(stage, { mode: 0o700 });
    mkdirSync(backup, { mode: 0o700 });
    const journal = join(root, "journal.jsonl");
    writeFileSync(journal, "", { mode: 0o600 });
    fsyncFile(journal);
    return successResult({ root, stage, backup, journal, lock, createdDirectories, entries: [] });
  } catch (error) {
    if (ownsLock) try { rmSync(lock); } catch { /* report the primary transaction setup failure */ }
    cleanupEmptyDirectories(createdDirectories);
    return failureResult([installDiagnostic("install.lock.unavailable", errorMessage(error), targetRoot)]);
  }
}

function stagePayload(bundle: VendorBundle, preflight: Preflight, transaction: Transaction): Result<true> {
  try {
    for (const write of preflight.changed) {
      const source = bundle.files.find((file) => file.path === write.source) as PayloadFile;
      const path = join(transaction.stage, ...write.destination.split("/"));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, source.content, { mode: write.mode });
      chmodSync(path, write.mode);
      fsyncFile(path);
      const staged = inspectFile(path);
      if (!staged.ok || staged.value.sha256 !== source.sha256 || staged.value.mode !== write.mode) {
        return failureResult([installDiagnostic("install.stage.invalid", "Staged file failed verification.", write.destination)]);
      }
    }
    return successResult(true);
  } catch (error) {
    return failureResult([installDiagnostic("install.stage.failed", errorMessage(error))]);
  }
}

function commitTransaction(
  bundle: VendorBundle,
  preflight: Preflight,
  transaction: Transaction,
  record: InstalledBundleRecord,
  hooks: InstallerTestHooks,
): Result<true> {
  let mutation = 0;
  try {
    for (const stale of preflight.stale) {
      const destination = join(preflight.targetRoot, ...stale.path.split("/"));
      const backup = backupFile(destination, stale.path, transaction);
      appendJournal(transaction, { kind: "removed", path: stale.path, backupPath: backup, priorSha256: stale.sha256, priorMode: stale.mode });
      hooks.beforeMutation?.({ index: mutation++, action: "remove", path: stale.path });
      rmSync(destination);
    }
    for (const write of preflight.changed) {
      const destination = join(preflight.targetRoot, ...write.destination.split("/"));
      const staged = join(transaction.stage, ...write.destination.split("/"));
      ensureParentDirectories(destination, transaction.createdDirectories);
      if (existsSync(destination)) {
        const prior = inspectFile(destination);
        if (!prior.ok) throw new Error(`Unable to inspect ${write.destination}.`);
        const backup = backupFile(destination, write.destination, transaction);
        appendJournal(transaction, { kind: "replaced", path: write.destination, backupPath: backup, priorSha256: prior.value.sha256, priorMode: prior.value.mode });
        hooks.beforeMutation?.({ index: mutation++, action: "remove", path: write.destination });
        rmSync(destination);
      } else {
        appendJournal(transaction, { kind: "created", path: write.destination });
      }
      hooks.beforeMutation?.({ index: mutation++, action: "install", path: write.destination });
      renameSync(staged, destination);
      chmodSync(destination, write.mode);
      fsyncDirectory(dirname(destination));
    }

    const recordContent = stableJson(recordToJson(record));
    const stagedRecord = join(transaction.stage, "installed-record.json");
    writeFileSync(stagedRecord, recordContent, { mode: 0o644 });
    chmodSync(stagedRecord, 0o644);
    fsyncFile(stagedRecord);
    ensureParentDirectories(preflight.recordPath, transaction.createdDirectories);
    if (existsSync(preflight.recordPath)) {
      const prior = inspectFile(preflight.recordPath);
      if (!prior.ok) throw new Error("Unable to inspect installed record.");
      const backup = backupFile(preflight.recordPath, preflight.recordRelative, transaction);
      appendJournal(transaction, { kind: "replaced", path: preflight.recordRelative, backupPath: backup, priorSha256: prior.value.sha256, priorMode: prior.value.mode });
      hooks.beforeMutation?.({ index: mutation++, action: "remove", path: preflight.recordRelative });
      rmSync(preflight.recordPath);
    } else {
      appendJournal(transaction, { kind: "created", path: preflight.recordRelative });
    }
    hooks.beforeMutation?.({ index: mutation++, action: "install", path: preflight.recordRelative });
    renameSync(stagedRecord, preflight.recordPath);
    fsyncDirectory(dirname(preflight.recordPath));
    return successResult(true);
  } catch (error) {
    return failureResult([installDiagnostic("install.commit.failed", errorMessage(error))]);
  }
}

function rollbackResult(transaction: Transaction, diagnostics: readonly Diagnostic[], hooks: InstallerTestHooks): InstallResult {
  let mutation = 0;
  try {
    for (const entry of [...transaction.entries].reverse()) {
      const destination = join(dirname(transaction.lock), "..", ...entry.path.split("/"));
      hooks.beforeRollbackMutation?.({ index: mutation++, action: "restore", path: entry.path });
      if (entry.kind === "created") {
        if (existsSync(destination)) rmSync(destination);
      } else {
        const backup = join(dirname(transaction.lock), "..", ...entry.backupPath.split("/"));
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        copyFileSync(backup, destination);
        chmodSync(destination, entry.priorMode);
        fsyncFile(destination);
      }
    }
    finishTransaction(transaction, false);
    return { kind: "rolled-back", diagnostics: [...diagnostics, installDiagnostic("install.rollback.complete", "Installation failed and prior managed state was restored.")] };
  } catch (error) {
    try { if (existsSync(transaction.lock)) rmSync(transaction.lock); } catch { /* preserve primary recovery path */ }
    return {
      kind: "rollback-failed",
      diagnostics: [...diagnostics, installDiagnostic("install.rollback.failed", errorMessage(error))],
      recoveryJournal: resolve(transaction.journal),
    };
  }
}

function createInstalledRecord(bundle: VendorBundle, plan: InstallPlan): InstalledBundleRecord {
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    plugin: bundle.manifest.plugin.name,
    version: bundle.manifest.plugin.version,
    vendor: bundle.manifest.vendor,
    adapterVersion: bundle.manifest.adapter.version,
    sourceDigest: bundle.manifest.sourceDigest,
    payloadDigest: bundle.manifest.payloadDigest,
    installedFiles: plan.writes.map((write) => {
      const file = bundle.files.find((candidate) => candidate.path === write.source) as PayloadFile;
      return { path: write.destination, sha256: file.sha256, mode: write.mode };
    }),
  };
}

function verifyInstalledState(targetRoot: string, recordPath: string, record: InstalledBundleRecord): Result<true> {
  const parsed = readInstalledRecord(recordPath);
  if (!parsed.ok || stableJson(recordToJson(parsed.value)) !== stableJson(recordToJson(record))) {
    return failureResult([installDiagnostic("install.verify.record", "Installed record failed verification.", recordPath)]);
  }
  for (const file of record.installedFiles) {
    const actual = inspectInstalledFile(targetRoot, file.path);
    if (!actual.ok || actual.value.sha256 !== file.sha256 || actual.value.mode !== file.mode) {
      return failureResult([installDiagnostic("install.verify.file", "Installed file failed verification.", file.path)]);
    }
  }
  return successResult(true);
}

function readInstalledRecords(targetRoot: string): Result<readonly InstalledBundleRecord[]> {
  const root = join(targetRoot, INSTALL_METADATA_DIRECTORY, "installed");
  if (!existsSync(root)) return successResult([]);
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return failureResult([installDiagnostic("install.preflight.metadata.invalid", "Installed-record directory is unsafe.", root)]);
    const records: InstalledBundleRecord[] = [];
    for (const entry of readdirSync(root).sort()) {
      if (!entry.endsWith(".json")) return failureResult([installDiagnostic("install.preflight.metadata.invalid", "Installed-record directory contains an unexpected entry.", entry)]);
      const parsed = readInstalledRecord(join(root, entry));
      if (!parsed.ok) return parsed;
      records.push(parsed.value);
    }
    return successResult(records);
  } catch (error) {
    return failureResult([installDiagnostic("install.preflight.metadata.invalid", errorMessage(error), root)]);
  }
}

function readInstalledRecord(path: string): Result<InstalledBundleRecord> {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Installed record must be a regular file.");
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(value) || !hasOnly(value, ["schemaVersion", "plugin", "version", "vendor", "adapterVersion", "sourceDigest", "payloadDigest", "installedFiles"]) ||
        value["schemaVersion"] !== BUNDLE_SCHEMA_VERSION || typeof value["plugin"] !== "string" || typeof value["version"] !== "string" ||
        typeof value["adapterVersion"] !== "string" || !isSha(value["sourceDigest"]) || !isSha(value["payloadDigest"]) || !Array.isArray(value["installedFiles"])) {
      throw new Error("Installed record schema is invalid.");
    }
    const vendor = typeof value["vendor"] === "string" ? parseVendorId(value["vendor"]) : failureResult<VendorId>([installDiagnostic("install.record.invalid", "Installed record vendor is invalid.")]);
    if (!vendor.ok) throw new Error("Installed record vendor is invalid.");
    const files = value["installedFiles"].map(parseInstalledFile);
    if (files.some((file) => !file.ok)) throw new Error("Installed record file entry is invalid.");
    const installedFiles = files.flatMap((file) => file.ok ? [file.value] : []);
    if (new Set(installedFiles.map((file) => file.path)).size !== installedFiles.length) throw new Error("Installed record paths must be unique.");
    return successResult({
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      plugin: value["plugin"],
      version: value["version"],
      vendor: vendor.value,
      adapterVersion: value["adapterVersion"],
      sourceDigest: value["sourceDigest"] as Sha256,
      payloadDigest: value["payloadDigest"] as Sha256,
      installedFiles,
    });
  } catch (error) {
    return failureResult([installDiagnostic("install.record.invalid", errorMessage(error), path)]);
  }
}

function parseInstalledFile(value: unknown): Result<InstalledBundleRecord["installedFiles"][number]> {
  if (!isRecord(value) || !hasOnly(value, ["path", "sha256", "mode"]) || typeof value["path"] !== "string" || !isSha(value["sha256"]) || typeof value["mode"] !== "number") return failureResult([installDiagnostic("install.record.invalid", "Installed file record is invalid.")]);
  const path = parseRelativePayloadPath(value["path"]);
  const mode = parsePortableFileMode(value["mode"]);
  if (!path.ok || !mode.ok) return failureResult([installDiagnostic("install.record.invalid", "Installed file path or mode is invalid.")]);
  return successResult({ path: path.value, sha256: value["sha256"] as Sha256, mode: mode.value });
}

function recordToJson(record: InstalledBundleRecord): JsonValue {
  return {
    schemaVersion: record.schemaVersion,
    plugin: record.plugin,
    version: record.version,
    vendor: record.vendor,
    adapterVersion: record.adapterVersion,
    sourceDigest: record.sourceDigest,
    payloadDigest: record.payloadDigest,
    installedFiles: record.installedFiles.map((file) => ({ path: file.path, sha256: file.sha256, mode: file.mode })),
  };
}

function appendJournal(transaction: Transaction, entry: JournalEntry): void {
  const handle = openSync(transaction.journal, "a", 0o600);
  try { writeSync(handle, stableJson(journalToJson(entry))); fsyncSync(handle); } finally { closeSync(handle); }
  transaction.entries.push(entry);
}

function journalToJson(entry: JournalEntry): JsonValue {
  return entry.kind === "created"
    ? { kind: entry.kind, path: entry.path }
    : { kind: entry.kind, path: entry.path, backupPath: entry.backupPath, priorSha256: entry.priorSha256, priorMode: entry.priorMode };
}

function backupFile(source: string, relativeSource: RelativePayloadPath, transaction: Transaction): RelativePayloadPath {
  const destination = join(transaction.backup, ...relativeSource.split("/"));
  const targetRoot = dirname(dirname(transaction.lock));
  const relativeBackup = relativePath(relative(targetRoot, destination).split(sep).join("/"));
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  fsyncFile(destination);
  return relativeBackup;
}

function inspectInstalledFile(root: string, path: RelativePayloadPath): Result<{ readonly sha256: Sha256; readonly mode: PortableFileMode }> {
  return inspectFile(join(root, ...path.split("/")));
}

function inspectFile(path: string): Result<{ readonly sha256: Sha256; readonly mode: PortableFileMode }> {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Not a regular file.");
    const mode = parsePortableFileMode(stat.mode & 0o777);
    if (!mode.ok) return failureResult(mode.diagnostics);
    return successResult({ sha256: sha256(readFileSync(path)), mode: mode.value });
  } catch (error) {
    return failureResult([installDiagnostic("install.file.unreadable", errorMessage(error), path)]);
  }
}

function ensureDirectory(path: string, created: string[], mode: number): void {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe metadata directory: ${path}`);
    return;
  }
  mkdirSync(path, { mode });
  chmodSync(path, mode);
  created.push(path);
}

function ensureParentDirectories(path: string, created: string[]): void {
  const missing: string[] = [];
  let cursor = dirname(path);
  while (!existsSync(cursor)) { missing.push(cursor); cursor = dirname(cursor); }
  const parent = lstatSync(cursor);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Unsafe destination parent: ${cursor}`);
  for (const directory of missing.reverse()) { mkdirSync(directory, { mode: 0o755 }); created.push(directory); }
}

function finishTransaction(transaction: Transaction, keepMetadata: boolean): void {
  if (existsSync(transaction.root)) rmSync(transaction.root, { recursive: true });
  if (existsSync(transaction.lock)) rmSync(transaction.lock);
  if (!keepMetadata) cleanupEmptyDirectories(transaction.createdDirectories);
}

function cleanupEmptyDirectories(created: readonly string[]): void {
  for (const directory of [...created].reverse()) {
    try { if (existsSync(directory) && readdirSync(directory).length === 0) rmdirSync(directory); } catch { /* best-effort metadata cleanup */ }
  }
}

function fsyncFile(path: string): void { const handle = openSync(path, "r"); try { fsyncSync(handle); } finally { closeSync(handle); } }
function fsyncDirectory(path: string): void { try { const handle = openSync(path, "r"); try { fsyncSync(handle); } finally { closeSync(handle); } } catch { /* unsupported on some platforms */ } }
function relativePath(path: string): RelativePayloadPath { const parsed = parseRelativePayloadPath(path); if (!parsed.ok) throw new Error(`Invalid internal path: ${path}`); return parsed.value; }
function successResult<T>(value: T): Result<T> { return { ok: true, value }; }
function failureResult<T = never>(diagnostics: readonly Diagnostic[]): Result<T> { const errors = diagnostics.length > 0 ? diagnostics : [installDiagnostic("install.unknown", "Installation failed.")]; return { ok: false, diagnostics: [errors[0] as Diagnostic, ...errors.slice(1)] }; }
function installDiagnostic(code: string, message: string, path?: string): Diagnostic { return { severity: "error", code, message, ...(path === undefined ? {} : { path }) }; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Installation operation failed."; }
function isSha(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasOnly(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value); }
