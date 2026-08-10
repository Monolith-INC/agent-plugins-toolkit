import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginInspection, PluginManifest } from "@agent-plugins/core";

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
