import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CLAUDE_SHIPPED_HELLO_WORLD, claudeAdapter } from "@agent-plugins/adapter-claude";
import { CODEX_SHIPPED_HELLO_WORLD, codexAdapter } from "@agent-plugins/adapter-codex";
import { CURSOR_SHIPPED_HELLO_WORLD, cursorAdapter } from "@agent-plugins/adapter-cursor";
import {
  finalizeVendorBundle,
  normalizeCanonicalPlugin,
  readVendorBundle,
  sha256,
} from "@agent-plugins/compiler";
import { createVendorInstaller, installVendorBundle } from "@agent-plugins/installer";
import { runInstallCommand } from "../dist/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const helloWorldRoot = join(repositoryRoot, "plugins", "hello-world");
const vendors = [
  {
    adapter: claudeAdapter,
    manifestPath: ".claude-plugin/plugin.json",
    packageRoot: "packages/adapter-claude",
    shipped: CLAUDE_SHIPPED_HELLO_WORLD,
  },
  {
    adapter: codexAdapter,
    manifestPath: ".codex-plugin/plugin.json",
    packageRoot: "packages/adapter-codex",
    shipped: CODEX_SHIPPED_HELLO_WORLD,
  },
  {
    adapter: cursorAdapter,
    manifestPath: ".cursor-plugin/plugin.json",
    packageRoot: "packages/adapter-cursor",
    shipped: CURSOR_SHIPPED_HELLO_WORLD,
  },
];

function snapshot(root, prefix = "") {
  if (!existsSync(root)) return [];
  return readdirSync(root).sort().flatMap((name) => {
    const absolute = join(root, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) return [{ path, kind: "directory", mode: stat.mode & 0o777 }, ...snapshot(absolute, path)];
    return [{ path, kind: "file", mode: stat.mode & 0o777, content: readFileSync(absolute).toString("base64") }];
  });
}

function compiledBundle(adapter, canonical, version) {
  const draft = adapter.compile({
    ...canonical,
    manifest: { ...canonical.manifest, version },
    sourceDigest: sha256(`${adapter.vendor}:${version}`),
  });
  assert.equal(draft.ok, true);
  const bundle = finalizeVendorBundle(draft.value);
  assert.equal(bundle.ok, true);
  return bundle.value;
}

function capture(operation) {
  const stdout = [];
  const stderr = [];
  const priorLog = console.log;
  const priorError = console.error;
  console.log = (value) => stdout.push(String(value));
  console.error = (value) => stderr.push(String(value));
  try { return { code: operation(), stdout: stdout.join("\n"), stderr: stderr.join("\n") }; }
  finally { console.log = priorLog; console.error = priorError; }
}

function markdownFiles(root) {
  return readdirSync(root).sort().flatMap((name) => {
    const absolute = join(root, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) return markdownFiles(absolute);
    return name.endsWith(".md") ? [absolute] : [];
  });
}

function relativeRepositoryPath(path) {
  return path.slice(repositoryRoot.length + 1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("every vendor supports install, unchanged reinstall, upgrade, compatible older install, rejected incompatible downgrade, and failed-upgrade rollback", () => {
  const canonical = normalizeCanonicalPlugin(helloWorldRoot);
  assert.equal(canonical.ok, true);

  for (const { adapter, shipped } of vendors) {
    const loaded = readVendorBundle(fileURLToPath(shipped));
    assert.equal(loaded.ok, true);
    const target = mkdtempSync(join(tmpdir(), `release-${adapter.vendor}-`));
    writeFileSync(join(target, "unrelated.txt"), "preserve me\n");

    const installed = installVendorBundle({ bundle: loaded.value, adapter, target: { root: target } });
    assert.equal(installed.kind, "installed", adapter.vendor);
    assert.equal(installVendorBundle({ bundle: loaded.value, adapter, target: { root: target } }).kind, "unchanged", adapter.vendor);

    const upgraded = compiledBundle(adapter, canonical.value, "2.0.0");
    assert.equal(installVendorBundle({ bundle: upgraded, adapter, target: { root: target } }).kind, "installed", adapter.vendor);

    const older = installVendorBundle({ bundle: loaded.value, adapter, target: { root: target } });
    assert.equal(older.kind, "installed", `${adapter.vendor} compatible older bundle`);

    const incompatible = {
      ...loaded.value,
      manifest: {
        ...loaded.value.manifest,
        adapter: { ...loaded.value.manifest.adapter, version: "0.0.0" },
      },
    };
    const rejected = installVendorBundle({ bundle: incompatible, adapter, target: { root: target } });
    assert.equal(rejected.kind, "failed-before-mutation", `${adapter.vendor} incompatible downgrade`);
    assert.ok(rejected.diagnostics.some((entry) => entry.code === "install.preflight.adapter_mismatch"));

    const beforeFailedUpgrade = snapshot(target);
    const failingInstaller = createVendorInstaller({
      beforeMutation(point) {
        if (point.index === 1) throw new Error("injected release-evidence fault");
      },
    });
    const failed = failingInstaller({
      bundle: compiledBundle(adapter, canonical.value, "3.0.0"),
      adapter,
      target: { root: target },
    });
    assert.equal(failed.kind, "rolled-back", `${adapter.vendor} failed upgrade`);
    assert.deepEqual(snapshot(target), beforeFailedUpgrade, `${adapter.vendor} exact rollback`);
    assert.equal(readFileSync(join(target, "unrelated.txt"), "utf8"), "preserve me\n");
  }
});

test("the installation path has no compilation, execution, elevation, or network call path", () => {
  const sources = [
    readFileSync(join(repositoryRoot, "packages", "installer", "src", "index.ts"), "utf8"),
    readFileSync(join(repositoryRoot, "packages", "cli", "src", "index.ts"), "utf8"),
  ].join("\n");
  const forbidden = [
    /\b(?:compilePlugin|compileVendorPayload|normalizeCanonicalPlugin|verifyShippedPayload)\s*\(/u,
    /\b(?:fetch|request|connect|createConnection)\s*\(/u,
    /node:(?:child_process|http|https|net|tls|dns)/u,
    /\b(?:spawn|spawnSync|execFile|execFileSync|eval|setuid|setgid|chown|chownSync)\s*\(/u,
    /\b(?:sudo|doas)\b/u,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(sources, pattern);
});

test("release documentation is backed by shipped payloads and exercised install commands", () => {
  const documentedFiles = [
    join(repositoryRoot, "README.md"),
    join(repositoryRoot, "CHANGELOG.md"),
    ...markdownFiles(join(repositoryRoot, "docs")),
  ];
  const documentation = documentedFiles.map((path) => readFileSync(path, "utf8")).join("\n");
  const forbiddenDocumentationModels = [
    /\bwire\b/iu,
    /post-install generation/iu,
    /dynamic artifact service/iu,
    /alternate install path/iu,
  ];
  for (const pattern of forbiddenDocumentationModels) assert.doesNotMatch(documentation, pattern);

  const commandPattern = /pnpm --filter @agent-plugins\/cli exec agent-plugin install (?<plugin>plugins\/hello-world) --vendor (?<vendor>claude|cursor|codex) --target <target-directory>/gu;
  const commands = [...documentation.matchAll(commandPattern)].map((match) => match.groups);
  assert.deepEqual(new Set(commands.map((command) => command.vendor)), new Set(["claude", "codex", "cursor"]));

  for (const command of commands) {
    const target = mkdtempSync(join(tmpdir(), `docs-${command.vendor}-`));
    const result = capture(() => runInstallCommand([
      join(repositoryRoot, command.plugin),
      "--vendor",
      command.vendor,
      "--target",
      target,
    ]));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).vendor, command.vendor);
  }

  for (const { adapter, manifestPath, packageRoot, shipped } of vendors) {
    const bundlePath = join(fileURLToPath(shipped), "bundle.json");
    const bundle = readJson(bundlePath);
    const documentedPath = relativeRepositoryPath(bundlePath);
    assert.match(documentation, new RegExp(documentedPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(documentation, new RegExp(bundle.payloadDigest, "u"));
    assert.match(documentation, new RegExp(bundle.adapter.vendorSchemaVersion, "u"));

    const packageManifest = readJson(join(repositoryRoot, packageRoot, "package.json"));
    assert.ok(packageManifest.files.includes("payloads"), `${adapter.vendor} package publishes payloads`);
    assert.ok(packageManifest.files.includes("schema"), `${adapter.vendor} package publishes schema evidence`);

    const vendorManifest = readJson(join(fileURLToPath(shipped), "payload", manifestPath));
    assert.equal(vendorManifest.sourceDigest, undefined);
    assert.equal(vendorManifest.payloadDigest, undefined);
    assert.equal(vendorManifest.adapter, undefined);
  }

  for (const path of [
    "AI_Codex/Features/age-13-vendor-payload-compiler-and-installer.md",
    "AI_Codex/Specs/age-13/design-doc.md",
    "AI_Codex/Specs/age-13/tech-spec.md",
    "AI_Codex/Specs/age-13/api-contract.md",
    "AI_Codex/Specs/age-13/implementation-plan.md",
  ]) {
    assert.ok(existsSync(join(repositoryRoot, path)), path);
    assert.match(documentation, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }

  for (const issue of ["AGE-13", "AGE-14", "AGE-15", "AGE-16", "AGE-17", "AGE-18", "AGE-19", "AGE-20", "AGE-21", "AGE-22", "AGE-23"]) {
    assert.match(documentation, new RegExp(`linear\\.app/agentical-monolithics/issue/${issue}`, "u"));
  }
  assert.match(documentation, /milestone-2087dd3f-72b8-433c-a2dc-144591aa64be/u);
});
