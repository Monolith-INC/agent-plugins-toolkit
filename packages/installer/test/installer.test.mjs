import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createPayloadFile,
  finalizeVendorBundle,
  validateInstallPlan,
  validateVendorBundle,
} from "@agent-plugins/compiler";
import {
  INSTALL_METADATA_DIRECTORY,
  createVendorInstaller,
  installVendorBundle,
} from "../dist/index.js";

function fixture(version = "1.0.0", files = { "a.txt": "alpha\n", "nested/b.txt": "beta\n" }) {
  const payload = Object.entries(files).map(([path, content]) => {
    const file = createPayloadFile({ path, content });
    assert.equal(file.ok, true);
    return file.value;
  });
  const finalized = finalizeVendorBundle({
    plugin: { name: "fixture", version },
    vendor: "cursor",
    adapter: { version: "1.0.0", vendorSchemaVersion: "fixture-1" },
    sourceDigest: "0".repeat(64),
    files: payload,
  });
  assert.equal(finalized.ok, true);
  return finalized.value;
}

function adapter() {
  return {
    vendor: "cursor",
    adapterVersion: "1.0.0",
    vendorSchemaVersion: "fixture-1",
    compile() { throw new Error("installer invoked compiler"); },
    validate: validateVendorBundle,
    planInstallation(bundle) {
      const plan = {
        plugin: bundle.manifest.plugin.name,
        version: bundle.manifest.plugin.version,
        vendor: bundle.manifest.vendor,
        bundleDigest: bundle.manifest.payloadDigest,
        writes: bundle.files.map((file) => ({ source: file.path, destination: file.path, mode: file.mode })),
      };
      const diagnostics = validateInstallPlan(plan, bundle);
      return diagnostics.length === 0 ? { ok: true, value: plan } : { ok: false, diagnostics };
    },
  };
}

function target() { return mkdtempSync(join(tmpdir(), "installer-target-")); }

function snapshot(root) {
  function visit(path, relative = "") {
    if (!existsSync(path)) return [];
    const entries = readdirSync(path).sort();
    return entries.flatMap((name) => {
      const absolute = join(path, name);
      const child = relative === "" ? name : `${relative}/${name}`;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) return [{ path: child, kind: "symlink" }];
      if (stat.isDirectory()) return [{ path: child, kind: "directory", mode: stat.mode & 0o777 }, ...visit(absolute, child)];
      return [{ path: child, kind: "file", mode: stat.mode & 0o777, content: readFileSync(absolute).toString("base64") }];
    });
  }
  return visit(root);
}

test("installs one complete bundle, writes a record, and reinstall is unchanged", () => {
  const root = target();
  const bundle = fixture();
  const first = installVendorBundle({ bundle, adapter: adapter(), target: { root } });
  assert.equal(first.kind, "installed");
  assert.equal(first.changedPaths, 2);
  assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "alpha\n");
  assert.equal(readFileSync(join(root, "nested/b.txt"), "utf8"), "beta\n");
  assert.equal(first.record.installedFiles.length, 2);
  const recordFiles = readdirSync(join(root, INSTALL_METADATA_DIRECTORY, "installed"));
  assert.equal(recordFiles.length, 1);

  const before = snapshot(root);
  const second = installVendorBundle({ bundle, adapter: adapter(), target: { root } });
  assert.equal(second.kind, "unchanged");
  assert.equal(second.changedPaths, 0);
  assert.deepEqual(snapshot(root), before);
});

test("rejects poisoned bundles, unowned collisions, symlinks, and held locks before payload mutation", () => {
  const original = fixture();
  const poisoned = { ...original, files: [{ ...original.files[0], content: new TextEncoder().encode("poison\n") }, ...original.files.slice(1)] };
  const poisonedRoot = target();
  assert.equal(installVendorBundle({ bundle: poisoned, adapter: adapter(), target: { root: poisonedRoot } }).kind, "failed-before-mutation");
  assert.deepEqual(snapshot(poisonedRoot), []);

  const collisionRoot = target();
  writeFileSync(join(collisionRoot, "a.txt"), "mine\n");
  chmodSync(join(collisionRoot, "a.txt"), 0o644);
  const collisionBefore = snapshot(collisionRoot);
  assert.equal(installVendorBundle({ bundle: original, adapter: adapter(), target: { root: collisionRoot } }).kind, "failed-before-mutation");
  assert.deepEqual(snapshot(collisionRoot), collisionBefore);

  const symlinkRoot = target();
  mkdirSync(join(symlinkRoot, "outside"));
  symlinkSync(join(symlinkRoot, "outside"), join(symlinkRoot, "nested"));
  const symlinkBefore = snapshot(symlinkRoot);
  assert.equal(installVendorBundle({ bundle: original, adapter: adapter(), target: { root: symlinkRoot } }).kind, "failed-before-mutation");
  assert.deepEqual(snapshot(symlinkRoot), symlinkBefore);

  const lockRoot = target();
  mkdirSync(join(lockRoot, INSTALL_METADATA_DIRECTORY), { mode: 0o700 });
  writeFileSync(join(lockRoot, INSTALL_METADATA_DIRECTORY, "install.lock"), "held\n", { mode: 0o600 });
  const lockBefore = snapshot(lockRoot);
  assert.equal(installVendorBundle({ bundle: original, adapter: adapter(), target: { root: lockRoot } }).kind, "failed-before-mutation");
  assert.deepEqual(snapshot(lockRoot), lockBefore);
});

test("deterministic upgrade replaces changed files and removes stale owned files", () => {
  const root = target();
  const first = installVendorBundle({ bundle: fixture(), adapter: adapter(), target: { root } });
  assert.equal(first.kind, "installed");
  const upgraded = fixture("2.0.0", { "a.txt": "alpha two\n", "c.txt": "gamma\n" });
  const result = installVendorBundle({ bundle: upgraded, adapter: adapter(), target: { root } });
  assert.equal(result.kind, "installed");
  assert.equal(result.changedPaths, 3);
  assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "alpha two\n");
  assert.equal(readFileSync(join(root, "c.txt"), "utf8"), "gamma\n");
  assert.equal(existsSync(join(root, "nested/b.txt")), false);
  assert.equal(result.record.version, "2.0.0");
});

test("every first-install mutation fault restores the exact empty target", () => {
  for (const fault of [0, 1, 2]) {
    const root = target();
    const installer = createVendorInstaller({
      beforeMutation(point) { if (point.index === fault) throw new Error(`fault ${fault}`); },
    });
    const result = installer({ bundle: fixture(), adapter: adapter(), target: { root } });
    assert.equal(result.kind, "rolled-back", `fault ${fault}`);
    assert.deepEqual(snapshot(root), [], `fault ${fault}`);
  }
});

test("every upgrade mutation fault restores exact prior managed state", () => {
  for (const fault of [0, 1, 2, 3, 4, 5]) {
    const root = target();
    assert.equal(installVendorBundle({ bundle: fixture(), adapter: adapter(), target: { root } }).kind, "installed");
    const before = snapshot(root);
    const installer = createVendorInstaller({
      beforeMutation(point) { if (point.index === fault) throw new Error(`upgrade fault ${fault}`); },
    });
    const upgraded = fixture("2.0.0", { "a.txt": "alpha two\n", "c.txt": "gamma\n" });
    const result = installer({ bundle: upgraded, adapter: adapter(), target: { root } });
    assert.equal(result.kind, "rolled-back", `fault ${fault}`);
    assert.deepEqual(snapshot(root), before, `fault ${fault}`);
  }
});

test("rollback failure preserves a durable recovery journal", () => {
  const root = target();
  const installer = createVendorInstaller({
    beforeMutation(point) { if (point.index === 1) throw new Error("commit fault"); },
    beforeRollbackMutation() { throw new Error("rollback fault"); },
  });
  const result = installer({ bundle: fixture(), adapter: adapter(), target: { root } });
  assert.equal(result.kind, "rollback-failed");
  assert.equal(existsSync(result.recoveryJournal), true);
  assert.ok(readFileSync(result.recoveryJournal, "utf8").includes('"kind"'));
});
