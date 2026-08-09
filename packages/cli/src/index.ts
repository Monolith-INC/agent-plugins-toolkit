#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginRoot, type PluginInspection } from "@agent-plugins/core";

const USAGE = `Usage: agent-plugin <command> [path]

Commands:
  validate [path]  Validate a plugin root (defaults to cwd)
  inspect  [path]  Inspect portable components as JSON (defaults to cwd)
`;

export function run(argv: readonly string[]): number {
  const [command, maybePath] = argv;
  const pluginPath = resolve(maybePath ?? process.cwd());

  switch (command) {
    case "validate":
      return validatePlugin(pluginPath);
    case "inspect":
      return printInspection(loadPluginRoot(pluginPath));
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE.trimEnd());
      return 0;
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE.trimEnd()}`);
      return 1;
  }
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
