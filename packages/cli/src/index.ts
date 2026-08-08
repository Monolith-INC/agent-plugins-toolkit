#!/usr/bin/env node
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

if (isCliEntrypoint()) {
  process.exitCode = run(process.argv.slice(2));
}

function isCliEntrypoint(): boolean {
  return process.argv[1]?.endsWith("/dist/index.js") ?? false;
}
