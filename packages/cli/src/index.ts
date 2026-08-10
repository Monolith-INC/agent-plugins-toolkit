#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CLAUDE_SHIPPED_HELLO_WORLD, claudeAdapter } from "@agent-plugins/adapter-claude";
import { CODEX_SHIPPED_HELLO_WORLD, codexAdapter } from "@agent-plugins/adapter-codex";
import { CURSOR_SHIPPED_HELLO_WORLD, cursorAdapter } from "@agent-plugins/adapter-cursor";
import {
  parseVendorId,
  readVendorBundle,
  type InstallResult,
  type Result,
  type VendorAdapter,
  type VendorBundle,
  type VendorId,
} from "@agent-plugins/compiler";

import {
  addSkillScaffold,
  createPluginScaffold,
  loadPluginRoot,
  pluginDirectoryName,
  type AuthoringResult,
  type PluginInspection,
} from "@agent-plugins/core";
import type { Diagnostic } from "@agent-plugins/core";
import { installVendorBundle } from "@agent-plugins/installer";

const USAGE = `Usage: agent-plugin <command> [options]

Commands:
  validate [path]                   Validate a plugin root (defaults to cwd)
  inspect  [path]                   Inspect portable components as JSON (defaults to cwd)
  install <plugin> --vendor <claude|cursor|codex> --target <directory>
                                    Install one shipped vendor payload transactionally
  create <plugin-name> [--path dir] Scaffold a portable plugin root
  add skill <skill-name> [--path dir]
                                    Add an immediate-child Skill to a plugin root
`;

const CREATE_USAGE = `Usage: agent-plugin create <plugin-name> [--path <dir>]`;
const ADD_SKILL_USAGE = `Usage: agent-plugin add skill <skill-name> [--path <plugin-root>]`;
const INSTALL_USAGE = `Usage: agent-plugin install <plugin> --vendor <claude|cursor|codex> --target <directory>`;

export function run(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  switch (command) {
    case "validate":
      return isHelpToken(rest[0]) ? printUsage(0) : validatePlugin(resolve(rest[0] ?? process.cwd()));
    case "inspect":
      return isHelpToken(rest[0])
        ? printUsage(0)
        : printInspection(loadPluginRoot(resolve(rest[0] ?? process.cwd())));
    case "create":
      return runCreate(rest);
    case "add":
      return runAdd(rest);
    case "install":
      return runInstallCommand(rest);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return printUsage(0);
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE.trimEnd()}`);
      return 1;
  }
}

export interface InstallCommandRuntime {
  readonly resolve: (plugin: string, vendor: VendorId) => Result<{ readonly bundle: VendorBundle; readonly adapter: VendorAdapter }>;
  readonly install: typeof installVendorBundle;
}

const DEFAULT_INSTALL_RUNTIME: InstallCommandRuntime = Object.freeze({
  resolve: resolveShippedBundle,
  install: installVendorBundle,
});

export function runInstallCommand(argv: readonly string[], runtime: InstallCommandRuntime = DEFAULT_INSTALL_RUNTIME): number {
  if (argv.some(isHelpToken)) return printText(INSTALL_USAGE, 0);
  const parsed = parseInstallArguments(argv);
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, outcome: "invalid-arguments", diagnostics: parsed.diagnostics }));
    return 2;
  }
  try {
    const resolved = runtime.resolve(parsed.value.plugin, parsed.value.vendor);
    if (!resolved.ok) {
      printInstallFailure("failed-before-mutation", resolved.diagnostics);
      return 3;
    }
    const target = resolve(parsed.value.target);
    const result = runtime.install({ bundle: resolved.value.bundle, adapter: resolved.value.adapter, target: { root: target } });
    return printInstallResult(result, target);
  } catch {
    printInstallFailure("failed-before-mutation", [cliDiagnostic("cli.unexpected", "Unexpected platform failure.")]);
    return 70;
  }
}

function parseInstallArguments(argv: readonly string[]): Result<{ readonly plugin: string; readonly vendor: VendorId; readonly target: string }> {
  const diagnostics: Diagnostic[] = [];
  const plugin = argv[0];
  if (plugin === undefined || plugin.startsWith("-")) diagnostics.push(cliDiagnostic("cli.arguments.plugin", "Exactly one plugin path is required."));
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if ((option !== "--vendor" && option !== "--target") || value === undefined || value.startsWith("--") || options.has(option)) {
      diagnostics.push(cliDiagnostic("cli.arguments.invalid", "Install arguments must contain one --vendor and one --target."));
      break;
    }
    options.set(option, value);
  }
  if (argv.length !== 5 || options.size !== 2) diagnostics.push(cliDiagnostic("cli.arguments.count", "Install accepts no extra or missing arguments."));
  const rawVendor = options.get("--vendor");
  const vendor = rawVendor === undefined ? undefined : parseVendorId(rawVendor);
  if (vendor === undefined || !vendor.ok) diagnostics.push(cliDiagnostic("cli.arguments.vendor", "Vendor must be exactly claude, cursor, or codex."));
  const target = options.get("--target");
  if (target === undefined) diagnostics.push(cliDiagnostic("cli.arguments.target", "Exactly one target directory is required."));
  if (diagnostics.length > 0 || plugin === undefined || vendor === undefined || !vendor.ok || target === undefined) {
    return { ok: false, diagnostics: [diagnostics[0] as Diagnostic, ...diagnostics.slice(1)] };
  }
  return { ok: true, value: { plugin: resolve(plugin), vendor: vendor.value, target } };
}

function resolveShippedBundle(pluginRoot: string, vendor: VendorId): Result<{ readonly bundle: VendorBundle; readonly adapter: VendorAdapter }> {
  const inspection = loadPluginRoot(pluginRoot);
  const errors = inspection.diagnostics.filter((entry) => entry.severity === "error");
  if (inspection.manifest === undefined || errors.length > 0) {
    const diagnostics = errors.length > 0 ? errors : [cliDiagnostic("cli.plugin.invalid", "Plugin distribution has no valid manifest.", pluginRoot)];
    return { ok: false, diagnostics: [diagnostics[0] as Diagnostic, ...diagnostics.slice(1)] };
  }
  if (inspection.manifest.name !== "hello-world") {
    return { ok: false, diagnostics: [cliDiagnostic("cli.payload.missing", "No shipped payload exists for this plugin.", inspection.manifest.name)] };
  }
  const selected = selectShippedAdapter(vendor);
  const bundle = readVendorBundle(fileURLToPath(selected.url));
  return bundle.ok ? { ok: true, value: { bundle: bundle.value, adapter: selected.adapter } } : bundle;
}

function selectShippedAdapter(vendor: VendorId): { readonly adapter: VendorAdapter; readonly url: URL } {
  switch (vendor) {
    case "claude": return { adapter: claudeAdapter, url: CLAUDE_SHIPPED_HELLO_WORLD };
    case "codex": return { adapter: codexAdapter, url: CODEX_SHIPPED_HELLO_WORLD };
    case "cursor": return { adapter: cursorAdapter, url: CURSOR_SHIPPED_HELLO_WORLD };
  }
}

function printInstallResult(result: InstallResult, target: string): number {
  switch (result.kind) {
    case "installed":
    case "unchanged":
      console.log(JSON.stringify({
        ok: true,
        outcome: result.kind,
        plugin: result.record.plugin,
        version: result.record.version,
        vendor: result.record.vendor,
        adapterVersion: result.record.adapterVersion,
        payloadDigest: result.record.payloadDigest,
        target,
        changedPaths: result.changedPaths,
      }));
      return 0;
    case "failed-before-mutation": printInstallFailure(result.kind, result.diagnostics); return 3;
    case "rolled-back": printInstallFailure(result.kind, result.diagnostics); return 4;
    case "rollback-failed": printInstallFailure(result.kind, result.diagnostics, result.recoveryJournal); return 5;
  }
}

function printInstallFailure(outcome: string, diagnostics: readonly Diagnostic[], recoveryJournal?: string): void {
  console.error(JSON.stringify({ ok: false, outcome, diagnostics, ...(recoveryJournal === undefined ? {} : { recoveryJournal }) }));
}

function cliDiagnostic(code: string, message: string, path?: string): Diagnostic {
  return { severity: "error", code, message, ...(path === undefined ? {} : { path }) };
}

function runCreate(argv: readonly string[]): number {
  if (argv.some(isHelpToken)) return printText(CREATE_USAGE, 0);

  const parsed = parseNameAndPath(argv);
  switch (parsed.kind) {
    case "missing-name":
      console.error(CREATE_USAGE);
      return 1;
    case "missing-path-value":
      console.error(`Missing value for --path\n\n${CREATE_USAGE}`);
      return 1;
    case "ok": {
      const destination =
        parsed.path ?? resolve(process.cwd(), pluginDirectoryName(parsed.name));
      return printAuthoring(
        createPluginScaffold({
          name: parsed.name,
          destination: resolve(destination),
          rawDestination: parsed.rawPath ?? destination,
        }),
        parsed.name,
      );
    }
  }
}

function runAdd(argv: readonly string[]): number {
  switch (argv[0]) {
    case "skill":
      return runAddSkill(argv.slice(1));
    case "help":
    case "--help":
    case "-h":
      return printText(ADD_SKILL_USAGE, 0);
    case undefined:
      console.error(ADD_SKILL_USAGE);
      return 1;
    default:
      console.error(`Unknown add target: ${argv[0]}\n\n${ADD_SKILL_USAGE}`);
      return 1;
  }
}

function runAddSkill(argv: readonly string[]): number {
  if (argv.some(isHelpToken)) return printText(ADD_SKILL_USAGE, 0);

  const parsed = parseNameAndPath(argv);
  switch (parsed.kind) {
    case "missing-name":
      console.error(ADD_SKILL_USAGE);
      return 1;
    case "missing-path-value":
      console.error(`Missing value for --path\n\n${ADD_SKILL_USAGE}`);
      return 1;
    case "ok": {
      const pluginRoot = parsed.path ?? process.cwd();
      return printAuthoring(
        addSkillScaffold({
          skillName: parsed.name,
          pluginRoot: resolve(pluginRoot),
          rawPluginRoot: parsed.rawPath ?? pluginRoot,
        }),
        parsed.name,
      );
    }
  }
}

type ParsedNamePath =
  | { readonly kind: "missing-name" }
  | { readonly kind: "missing-path-value" }
  | {
      readonly kind: "ok";
      readonly name: string;
      readonly path?: string;
      readonly rawPath?: string;
    };

function parseNameAndPath(argv: readonly string[]): ParsedNamePath {
  const pathIndex = argv.findIndex((token) => token === "--path");
  switch (pathIndex) {
    case -1: {
      const name = argv[0];
      return name === undefined ? { kind: "missing-name" } : { kind: "ok", name };
    }
    default: {
      const rawPath = argv[pathIndex + 1];
      if (rawPath === undefined) return { kind: "missing-path-value" };
      const name = argv.filter((_, index) => index !== pathIndex && index !== pathIndex + 1)[0];
      return name === undefined
        ? { kind: "missing-name" }
        : { kind: "ok", name, path: rawPath, rawPath };
    }
  }
}

function printAuthoring(result: AuthoringResult, name: string): number {
  switch (result.diagnostics.length === 0) {
    case true:
      console.log(
        JSON.stringify(
          {
            ok: true,
            path: result.path,
            name: result.name ?? name,
            ...(result.nextSteps === undefined ? {} : { nextSteps: result.nextSteps }),
          },
          null,
          2,
        ),
      );
      return 0;
    case false:
      console.error(JSON.stringify(result.diagnostics, null, 2));
      return 1;
  }
}

function isHelpToken(token: string | undefined): boolean {
  switch (token) {
    case "help":
    case "--help":
    case "-h":
      return true;
    default:
      return false;
  }
}

function printUsage(exitCode: number): number {
  return printText(USAGE.trimEnd(), exitCode);
}

function printText(text: string, exitCode: number): number {
  console.log(text);
  return exitCode;
}

function validatePlugin(pluginPath: string): number {
  const inspection = loadPluginRoot(pluginPath);
  const hasError = inspection.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  switch (hasError) {
    case true:
      console.error(JSON.stringify(inspection.diagnostics, null, 2));
      return 1;
    case false:
      console.log(JSON.stringify({ ok: true }));
      return 0;
  }
}

function printInspection(inspection: PluginInspection): number {
  console.log(JSON.stringify(inspection, null, 2));
  return inspection.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0;
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  process.exit(run(process.argv.slice(2)));
}

function isCliEntrypoint(entrypoint: string | undefined, moduleUrl: string): boolean {
  if (!entrypoint) return false;
  return toRealPath(entrypoint) === toRealPath(fileURLToPath(moduleUrl));
}

function toRealPath(path: string): string {
  return realpathSync(resolve(path));
}
