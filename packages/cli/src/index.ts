#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addSkillScaffold,
  createPluginScaffold,
  loadPluginRoot,
  pluginDirectoryName,
  type AuthoringResult,
  type PluginInspection,
} from "@agent-plugins/core";

const USAGE = `Usage: agent-plugin <command> [options]

Commands:
  validate [path]                   Validate a plugin root (defaults to cwd)
  inspect  [path]                   Inspect portable components as JSON (defaults to cwd)
  create <plugin-name> [--path dir] Scaffold a portable plugin root
  add skill <skill-name> [--path dir]
                                    Add an immediate-child Skill to a plugin root
`;

const CREATE_USAGE = `Usage: agent-plugin create <plugin-name> [--path <dir>]`;
const ADD_SKILL_USAGE = `Usage: agent-plugin add skill <skill-name> [--path <plugin-root>]`;

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
