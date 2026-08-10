import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileVendorPayload,
  verifyVendorPayload,
} from "@agent-plugins/compiler";

import { cursorAdapter } from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const source = join(repositoryRoot, "plugins", "hello-world");
const shipped = join(packageRoot, "payloads", "hello-world");
const operation = process.argv[2];

const result = operation === "build"
  ? compileVendorPayload({ source, vendor: "cursor", output: shipped }, cursorAdapter)
  : operation === "verify"
    ? verifyVendorPayload({ source, vendor: "cursor", shipped }, cursorAdapter)
    : { ok: false, diagnostics: [{ code: "cursor.script.usage", message: "Expected build or verify." }] };

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
