import type { PluginManifest } from "@agent-plugins/core";

export function createManifestFixture(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: "fixture-plugin",
    version: "1.0.0",
    description: "Fixture plugin manifest.",
    ...overrides,
  };
}
