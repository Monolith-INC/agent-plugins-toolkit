import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPluginRoot } from "@agent-plugins/core";

import {
  assertFixtureExpectation,
  listFixtureRoots,
  readFixtureExpectation,
} from "../dist/index.js";

test("listFixtureRoots returns sorted fixtures with expected.json", () => {
  const valid = listFixtureRoots("valid");
  const invalid = listFixtureRoots("invalid");
  assert.ok(valid.length >= 5);
  assert.ok(invalid.length >= 10);
  assert.deepEqual(
    valid,
    [...valid].reduce((items, item) => {
      const index = items.findIndex((existing) => item.localeCompare(existing, "en") < 0);
      return index === -1 ? [...items, item] : [...items.slice(0, index), item, ...items.slice(index)];
    }, []),
  );
  assert.ok(valid.every((root) => root.includes("/fixtures/valid/")));
  assert.ok(invalid.every((root) => root.includes("/fixtures/invalid/")));
});

test("fixture corpus matches expected.json contracts", () => {
  ["valid", "invalid"].map((kind) =>
    listFixtureRoots(kind).map((fixtureRoot) => {
      const expectation = readFixtureExpectation(fixtureRoot);
      assert.equal(expectation.ok, true, expectation.ok ? "" : expectation.message);
      if (!expectation.ok) return fixtureRoot;
      assert.equal(expectation.value.kind, kind);
      assertFixtureExpectation(loadPluginRoot(fixtureRoot), expectation.value);
      return fixtureRoot;
    }),
  );
});

test("readFixtureExpectation rejects malformed metadata as a value", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugins-expected-"));
  writeFileSync(join(root, "expected.json"), JSON.stringify({ id: "x" }));
  const result = readFixtureExpectation(root);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /kind/);
});

test("testing helpers do not spawn processes", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts"),
    "utf8",
  );
  assert.equal(source.includes("child_process"), false);
  assert.equal(source.includes("fetch("), false);
});
