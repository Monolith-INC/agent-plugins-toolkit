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

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const helloWorldRoot = join(repositoryRoot, "plugins", "hello-world");
const vendors = [
  { adapter: claudeAdapter, shipped: CLAUDE_SHIPPED_HELLO_WORLD },
  { adapter: codexAdapter, shipped: CODEX_SHIPPED_HELLO_WORLD },
  { adapter: cursorAdapter, shipped: CURSOR_SHIPPED_HELLO_WORLD },
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
