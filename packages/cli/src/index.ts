#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectManifest } from "@agent-plugins/core";

export function run(argv: readonly string[]): number {
  const [command] = argv;

  if (command === "inspect-empty") {
    const inspection = inspectManifest({});
    console.log(JSON.stringify(inspection, null, 2));
    return inspection.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0;
  }

  console.log("agent-plugin: bootstrap CLI");
  return 0;
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}

function isCliEntrypoint(entrypoint: string | undefined, moduleUrl: string): boolean {
  if (!entrypoint) return false;
  return toRealPath(entrypoint) === toRealPath(fileURLToPath(moduleUrl));
}

function toRealPath(path: string): string {
  return realpathSync(resolve(path));
}
