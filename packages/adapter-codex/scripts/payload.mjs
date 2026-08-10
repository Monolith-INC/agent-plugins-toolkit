import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileVendorPayload, verifyVendorPayload } from "@agent-plugins/compiler";
import { codexAdapter } from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const source = join(repositoryRoot, "plugins", "hello-world");
const shipped = join(packageRoot, "payloads", "hello-world");
const operation = process.argv[2];
const result = operation === "build"
  ? compileVendorPayload({ source, vendor: "codex", output: shipped }, codexAdapter)
  : operation === "verify"
    ? verifyVendorPayload({ source, vendor: "codex", shipped }, codexAdapter)
    : { ok: false, diagnostics: [{ code: "codex.script.usage", message: "Expected build or verify." }] };

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
