import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginInspection, PluginManifest } from "@agent-plugins/core";
import {
  finalizeVendorBundle,
  listVendorAdapters,
  validateInstallPlan,
  type CanonicalPlugin,
  type InstallPlan,
  type InstallTarget,
  type PortableFileMode,
  type Sha256,
  type VendorAdapter,
  type VendorBundle,
} from "@agent-plugins/compiler";

export interface FixtureExpectation {
  readonly id: string;
  readonly kind: "valid" | "invalid";
  readonly description: string;
  readonly validateExitCode: 0 | 1;
  readonly diagnosticCodes: readonly string[];
  readonly requireManifest?: boolean;
  readonly skillPaths?: readonly string[];
}

export type ExpectationRead =
  | { readonly ok: true; readonly value: FixtureExpectation }
  | { readonly ok: false; readonly message: string };

export interface GoldenPayloadFile {
  readonly path: string;
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly mode: PortableFileMode;
  readonly contentBase64: string;
}

export interface AdapterConformanceInput {
  readonly adapter: VendorAdapter;
  readonly plugin: CanonicalPlugin;
  readonly target: InstallTarget;
  readonly golden?: readonly GoldenPayloadFile[];
}

export interface AdapterConformanceEvidence {
  readonly vendor: VendorAdapter["vendor"];
  readonly bundle: VendorBundle;
  readonly plan: InstallPlan;
  readonly golden: readonly GoldenPayloadFile[];
}

export function createManifestFixture(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: "fixture-plugin",
    version: "1.0.0",
    description: "Fixture plugin manifest.",
    ...overrides,
  };
}

export function defaultFixturesRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
}

export function listFixtureRoots(
  kind: "valid" | "invalid",
  fixturesRoot: string = defaultFixturesRoot(),
): readonly string[] {
  const kindRoot = resolve(fixturesRoot, kind);
  if (!existsSync(kindRoot)) return [];

  return readdirSync(kindRoot, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const fixtureRoot = join(kindRoot, entry.name);
      return existsSync(join(fixtureRoot, "expected.json")) ? [fixtureRoot] : [];
    })
    .reduce<readonly string[]>(insertSorted, []);
}

export function readFixtureExpectation(fixtureRoot: string): ExpectationRead {
  const absoluteRoot = isAbsolute(fixtureRoot) ? fixtureRoot : resolve(fixtureRoot);
  try {
    const raw = JSON.parse(readFileSync(join(absoluteRoot, "expected.json"), "utf8")) as unknown;
    const parsed = parseFixtureExpectation(raw);
    return parsed.ok
      ? parsed
      : { ok: false, message: `${parsed.message} at ${absoluteRoot}` };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `${error.message} at ${absoluteRoot}`
          : `Unable to read expected.json at ${absoluteRoot}`,
    };
  }
}

export function assertFixtureExpectation(
  inspection: PluginInspection,
  expectation: FixtureExpectation,
): void {
  const errorCodes = inspection.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
  const exitCode = errorCodes.length === 0 ? 0 : 1;
  assert.equal(
    exitCode,
    expectation.validateExitCode,
    `${expectation.id}: validateExitCode mismatch`,
  );

  expectation.diagnosticCodes.map((code) =>
    assert.ok(
      errorCodes.includes(code),
      `${expectation.id}: missing diagnostic code ${code} (got ${errorCodes.join(", ") || "none"})`,
    ),
  );

  switch (expectation.requireManifest) {
    case true:
      assert.ok(inspection.manifest !== undefined, `${expectation.id}: expected manifest`);
      break;
    case false:
      assert.equal(inspection.manifest, undefined, `${expectation.id}: expected no manifest`);
      break;
    case undefined:
      break;
  }

  if (expectation.skillPaths === undefined) return;
  assert.deepEqual(
    inspection.skills?.map((skill) => skill.path) ?? [],
    expectation.skillPaths,
    `${expectation.id}: skillPaths mismatch`,
  );
}

export function captureGoldenPayload(
  bundle: VendorBundle,
): readonly GoldenPayloadFile[] {
  return Object.freeze(
    bundle.files.map((file) =>
      Object.freeze({
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
        mode: file.mode,
        contentBase64: Buffer.from(file.content).toString("base64"),
      }),
    ),
  );
}

export function assertGoldenPayload(
  actual: VendorBundle,
  expected: readonly GoldenPayloadFile[],
): void {
  assert.deepEqual(captureGoldenPayload(actual), expected);
}

export function assertVendorAdapterConformance(
  input: AdapterConformanceInput,
): AdapterConformanceEvidence {
  const sourceBefore = snapshotTree(input.plugin.root);
  const targetBefore = snapshotTree(input.target.root);
  const pluginBefore = structuredClone(input.plugin);

  try {
    const firstDraft = input.adapter.compile(input.plugin);
    const secondDraft = input.adapter.compile(input.plugin);
    assert.equal(firstDraft.ok, true, formatResultFailure("first compile", firstDraft));
    assert.equal(secondDraft.ok, true, formatResultFailure("second compile", secondDraft));
    if (!firstDraft.ok || !secondDraft.ok) {
      throw new assert.AssertionError({ message: "Adapter compile failed." });
    }
    for (const draft of [firstDraft.value, secondDraft.value]) {
      assert.deepEqual(draft.plugin, {
        name: input.plugin.manifest.name,
        version: input.plugin.manifest.version,
      });
      assert.equal(draft.vendor, input.adapter.vendor);
      assert.deepEqual(draft.adapter, {
        version: input.adapter.adapterVersion,
        vendorSchemaVersion: input.adapter.vendorSchemaVersion,
      });
      assert.equal(draft.sourceDigest, input.plugin.sourceDigest);
    }

    const firstBundle = finalizeVendorBundle(firstDraft.value);
    const secondBundle = finalizeVendorBundle(secondDraft.value);
    assert.equal(firstBundle.ok, true, formatResultFailure("first bundle", firstBundle));
    assert.equal(secondBundle.ok, true, formatResultFailure("second bundle", secondBundle));
    if (!firstBundle.ok || !secondBundle.ok) {
      throw new assert.AssertionError({ message: "Adapter bundle finalization failed." });
    }

    assert.deepEqual(firstBundle.value.manifest, secondBundle.value.manifest);
    assert.deepEqual(captureGoldenPayload(firstBundle.value), captureGoldenPayload(secondBundle.value));
    assert.deepEqual(input.adapter.validate(firstBundle.value), []);
    assert.deepEqual(input.adapter.validate(secondBundle.value), []);

    const firstPlan = input.adapter.planInstallation(firstBundle.value, input.target);
    const secondPlan = input.adapter.planInstallation(secondBundle.value, input.target);
    assert.equal(firstPlan.ok, true, formatResultFailure("first plan", firstPlan));
    assert.equal(secondPlan.ok, true, formatResultFailure("second plan", secondPlan));
    if (!firstPlan.ok || !secondPlan.ok) {
      throw new assert.AssertionError({ message: "Adapter installation planning failed." });
    }
    assert.deepEqual(firstPlan.value, secondPlan.value);
    assert.deepEqual(validateInstallPlan(firstPlan.value, firstBundle.value), []);

    const golden = captureGoldenPayload(firstBundle.value);
    if (input.golden !== undefined) assert.deepEqual(golden, input.golden);

    return Object.freeze({
      vendor: input.adapter.vendor,
      bundle: firstBundle.value,
      plan: firstPlan.value,
      golden,
    });
  } finally {
    assert.deepEqual(input.plugin, pluginBefore, "adapter mutated canonical input");
    assert.deepEqual(snapshotTree(input.target.root), targetBefore, "adapter mutated the installation target");
    assert.deepEqual(snapshotTree(input.plugin.root), sourceBefore, "adapter mutated the build filesystem");
  }
}

export function assertAdapterModuleHasNoFilesystemEffects(
  source: string,
  label = "adapter module",
): void {
  const childProcessModule = `node:child_${"process"}`;
  const forbidden = new RegExp(
    `(?:node:fs(?:/promises)?|["']fs["']|${childProcessModule}|process\\.chdir|Deno\\.|Bun\\.)`,
    "u",
  );
  assert.doesNotMatch(
    source,
    forbidden,
    `${label} imports or invokes a filesystem/process mutation capability`,
  );
}

export function assertCompleteVendorConformance(
  evidence: readonly AdapterConformanceEvidence[],
): void {
  assert.deepEqual(
    evidence.map((entry) => entry.vendor),
    listVendorAdapters(),
    "conformance must run once in lexical order for Claude, Codex, and Cursor",
  );
}

function parseFixtureExpectation(value: unknown): ExpectationRead {
  if (!isRecord(value)) {
    return { ok: false, message: "expected.json must be an object" };
  }

  const id = readString(value, "id");
  if (!id.ok) return id;
  const kind = readKind(value);
  if (!kind.ok) return kind;
  const description = readString(value, "description");
  if (!description.ok) return description;
  const validateExitCode = readExitCode(value);
  if (!validateExitCode.ok) return validateExitCode;
  const diagnosticCodes = readStringArray(value, "diagnosticCodes");
  if (!diagnosticCodes.ok) return diagnosticCodes;
  const requireManifest = readOptionalBoolean(value, "requireManifest");
  if (!requireManifest.ok) return requireManifest;
  const skillPaths = readOptionalStringArray(value, "skillPaths");
  if (!skillPaths.ok) return skillPaths;

  return {
    ok: true,
    value: {
      id: id.value,
      kind: kind.value,
      description: description.value,
      validateExitCode: validateExitCode.value,
      diagnosticCodes: diagnosticCodes.value,
      ...(requireManifest.value === undefined ? {} : { requireManifest: requireManifest.value }),
      ...(skillPaths.value === undefined ? {} : { skillPaths: skillPaths.value }),
    },
  };
}

interface TreeEntry {
  readonly path: string;
  readonly kind: "directory" | "file" | "symlink" | "other";
  readonly mode: number;
  readonly contentBase64?: string;
  readonly link?: string;
}

function snapshotTree(root: string): readonly TreeEntry[] {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot)) return [];
  return snapshotEntry(absoluteRoot, ".");
}

function snapshotEntry(absolutePath: string, relativePath: string): readonly TreeEntry[] {
  const stat = lstatSync(absolutePath);
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) {
    return [{ path: relativePath, kind: "symlink", mode, link: readlinkSync(absolutePath) }];
  }
  if (stat.isFile()) {
    return [{
      path: relativePath,
      kind: "file",
      mode,
      contentBase64: readFileSync(absolutePath).toString("base64"),
    }];
  }
  if (!stat.isDirectory()) return [{ path: relativePath, kind: "other", mode }];

  const children = readdirSync(absolutePath).sort(compareStrings);
  return [
    { path: relativePath, kind: "directory", mode },
    ...children.flatMap((child) =>
      snapshotEntry(join(absolutePath, child), relativePath === "." ? child : join(relativePath, child)),
    ),
  ];
}

function formatResultFailure(
  stage: string,
  result: { readonly ok: boolean; readonly diagnostics?: readonly { readonly code: string }[] },
): string {
  return result.ok
    ? ""
    : `${stage} failed: ${result.diagnostics?.map((entry) => entry.code).join(", ") ?? "unknown"}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readKind(
  value: Record<string, unknown>,
): { readonly ok: true; readonly value: "valid" | "invalid" } | { readonly ok: false; readonly message: string } {
  const kind = value["kind"];
  switch (kind) {
    case "valid":
    case "invalid":
      return { ok: true, value: kind };
    default:
      return { ok: false, message: 'expected.json field "kind" must be "valid" or "invalid"' };
  }
}

function readExitCode(
  value: Record<string, unknown>,
): { readonly ok: true; readonly value: 0 | 1 } | { readonly ok: false; readonly message: string } {
  const code = value["validateExitCode"];
  switch (code) {
    case 0:
    case 1:
      return { ok: true, value: code };
    default:
      return { ok: false, message: 'expected.json field "validateExitCode" must be 0 or 1' };
  }
}

function readString(
  value: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const entry = value[key];
  return typeof entry === "string" && entry.length > 0
    ? { ok: true, value: entry }
    : { ok: false, message: `expected.json field "${key}" must be a non-empty string` };
}

function readStringArray(
  value: Record<string, unknown>,
  key: string,
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly message: string } {
  const entry = value[key];
  return Array.isArray(entry) && entry.every((item) => typeof item === "string")
    ? { ok: true, value: entry }
    : { ok: false, message: `expected.json field "${key}" must be a string array` };
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  key: string,
):
  | { readonly ok: true; readonly value: readonly string[] | undefined }
  | { readonly ok: false; readonly message: string } {
  return value[key] === undefined
    ? { ok: true, value: undefined }
    : readStringArray(value, key);
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
):
  | { readonly ok: true; readonly value: boolean | undefined }
  | { readonly ok: false; readonly message: string } {
  const entry = value[key];
  if (entry === undefined) return { ok: true, value: undefined };
  return typeof entry === "boolean"
    ? { ok: true, value: entry }
    : { ok: false, message: `expected.json field "${key}" must be a boolean` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function insertSorted(items: readonly string[], item: string): readonly string[] {
  const index = items.findIndex((existing) => item.localeCompare(existing, "en") < 0);
  return index === -1 ? [...items, item] : [...items.slice(0, index), item, ...items.slice(index)];
}
