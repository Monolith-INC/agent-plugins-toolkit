import type { Diagnostic, PluginMcpServer } from "@agent-plugins/core";
import {
  createJsonPayloadFile,
  createMarkdownPayloadFile,
  failure,
  success,
  validateInstallPlan,
  validateVendorBundle,
  type CanonicalHookIntent,
  type CanonicalPlugin,
  type InstallPlan,
  type InstallTarget,
  type JsonValue,
  type PayloadFile,
  type Result,
  type VendorAdapter,
  type VendorBundle,
  type VendorBundleDraft,
} from "@agent-plugins/compiler";

export const CODEX_ADAPTER_VERSION = "1.0.0" as const;
export const CODEX_SCHEMA_VERSION = "codex-plugins-2026-08-10" as const;
export const CODEX_SCHEMA_EVIDENCE = Object.freeze([
  "https://developers.openai.com/plugins/build/plugins",
  "https://learn.chatgpt.com/docs/hooks",
] as const);
export const CODEX_SHIPPED_HELLO_WORLD = new URL("../payloads/hello-world", import.meta.url);

const MANIFEST_PATH = ".codex-plugin/plugin.json";
const HOOKS_PATH = "hooks/hooks.json";
const MCP_PATH = ".mcp.json";
const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const codexAdapter: VendorAdapter = Object.freeze({
  vendor: "codex",
  adapterVersion: CODEX_ADAPTER_VERSION,
  vendorSchemaVersion: CODEX_SCHEMA_VERSION,
  compile: compileCodexPayload,
  validate: validateCodexBundle,
  planInstallation: planCodexInstallation,
});

export function compileCodexPayload(plugin: CanonicalPlugin): Result<VendorBundleDraft> {
  const name = pluginName(plugin.manifest.name);
  if (!NAME.test(name)) return fail("codex.manifest.name", "Canonical name cannot map to a Codex plugin name.", "manifest.name");
  if (plugin.rules.length > 0) {
    return fail("codex.rule.unsupported", "Codex plugin packages have no native content-rules component.", plugin.rules[0]?.id);
  }
  const hooks = renderHooks(plugin.hookIntents);
  const mcp = renderMcp(plugin.mcpServers);
  const diagnostics = [...(hooks.ok ? [] : hooks.diagnostics), ...(mcp.ok ? [] : mcp.diagnostics)];
  if (diagnostics.length > 0) return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));

  const files: Result<PayloadFile>[] = [
    createJsonPayloadFile({
      path: MANIFEST_PATH,
      value: {
        name,
        version: plugin.manifest.version,
        ...(plugin.manifest.description === undefined ? {} : { description: plugin.manifest.description }),
        ...(plugin.skills.length === 0 ? {} : { skills: "./skills/" }),
        ...(plugin.hookIntents.length === 0 ? {} : { hooks: `./${HOOKS_PATH}` }),
        ...(plugin.mcpServers.length === 0 ? {} : { mcpServers: `./${MCP_PATH}` }),
      },
    }),
    ...plugin.skills.map((skill) => createMarkdownPayloadFile({ path: skill.path, content: skill.content })),
    ...(hooks.ok && hooks.value !== undefined ? [createJsonPayloadFile({ path: HOOKS_PATH, value: hooks.value })] : []),
    ...(mcp.ok && mcp.value !== undefined ? [createJsonPayloadFile({ path: MCP_PATH, value: mcp.value })] : []),
  ];
  const fileDiagnostics = files.flatMap((result) => result.ok ? [] : result.diagnostics);
  if (fileDiagnostics.length > 0) return failure(fileDiagnostics[0] as Diagnostic, ...fileDiagnostics.slice(1));
  return success({
    plugin: { name: plugin.manifest.name, version: plugin.manifest.version },
    vendor: "codex",
    adapter: { version: CODEX_ADAPTER_VERSION, vendorSchemaVersion: CODEX_SCHEMA_VERSION },
    sourceDigest: plugin.sourceDigest,
    files: files.flatMap((result) => result.ok ? [result.value] : []),
  });
}

export function validateCodexBundle(bundle: VendorBundle): readonly Diagnostic[] {
  const common = validateVendorBundle(bundle);
  if (common.length > 0) return common;
  const diagnostics: Diagnostic[] = [];
  if (bundle.manifest.vendor !== "codex" || bundle.manifest.adapter.version !== CODEX_ADAPTER_VERSION ||
      bundle.manifest.adapter.vendorSchemaVersion !== CODEX_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("codex.bundle.identity", "Bundle is not owned by this Codex adapter."));
  }
  const paths = new Set<string>(bundle.files.map((file) => file.path));
  const allowed = /^(?:\.codex-plugin\/plugin\.json|skills\/[^/]+\/SKILL\.md|hooks\/hooks\.json|\.mcp\.json)$/;
  for (const file of bundle.files) {
    if (!allowed.test(file.path)) diagnostics.push(diagnostic("codex.payload.path", "Unexpected Codex payload path.", file.path));
  }
  const manifest = parseJson(bundle, MANIFEST_PATH);
  if (!manifest.ok) diagnostics.push(...manifest.diagnostics);
  else diagnostics.push(...validateManifest(manifest.value, paths));
  for (const file of bundle.files.filter((entry) => entry.path.startsWith("skills/"))) {
    const text = decodeText(file);
    if (!text.ok || !/^---\n[\s\S]*\n---\n/u.test(text.value)) diagnostics.push(diagnostic("codex.skill.invalid", "Codex Skills require YAML frontmatter.", file.path));
  }
  if (paths.has(HOOKS_PATH)) diagnostics.push(...validateHooks(parseJson(bundle, HOOKS_PATH)));
  if (paths.has(MCP_PATH)) diagnostics.push(...validateMcp(parseJson(bundle, MCP_PATH)));
  return diagnostics;
}

export function planCodexInstallation(bundle: VendorBundle, _target: InstallTarget): Result<InstallPlan> {
  const diagnostics = validateCodexBundle(bundle);
  if (diagnostics.length > 0) return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  const plan: InstallPlan = {
    plugin: bundle.manifest.plugin.name,
    version: bundle.manifest.plugin.version,
    vendor: "codex",
    bundleDigest: bundle.manifest.payloadDigest,
    writes: bundle.files.map((file) => ({ source: file.path, destination: file.path, mode: file.mode })),
  };
  const planDiagnostics = validateInstallPlan(plan, bundle);
  return planDiagnostics.length === 0 ? success(plan) : failure(planDiagnostics[0] as Diagnostic, ...planDiagnostics.slice(1));
}

type Hook = { readonly type: "command"; readonly command: string; readonly timeout?: number };
type HookGroup = { readonly matcher?: string; readonly hooks: readonly Hook[] };

function renderHooks(intents: readonly CanonicalHookIntent[]): Result<JsonValue | undefined> {
  if (intents.length === 0) return success(undefined);
  const hooks: Record<string, HookGroup[]> = {};
  for (const intent of intents) {
    const mappings = hookMappings(intent);
    if (!mappings.ok) return mappings;
    for (const mapping of mappings.value) {
      hooks[mapping.event] = [
        ...(hooks[mapping.event] ?? []),
        {
          ...(mapping.matcher === undefined ? {} : { matcher: mapping.matcher }),
          hooks: [{
            type: "command",
            command: [intent.executable, ...intent.arguments].map((part) => JSON.stringify(part)).join(" "),
            ...(intent.timeoutSeconds === undefined ? {} : { timeout: intent.timeoutSeconds }),
          }],
        },
      ];
    }
  }
  return success({ hooks });
}

function hookMappings(intent: CanonicalHookIntent): Result<readonly { readonly event: string; readonly matcher?: string }[]> {
  switch (intent.lifecycle) {
    case "session-start": return success([{ event: "SessionStart" }]);
    case "session-end": return success([{ event: "SessionEnd" }]);
    case "before-prompt": return success([{ event: "UserPromptSubmit" }]);
    case "stop": return success([{ event: "Stop" }]);
    case "before-tool":
    case "after-tool": {
      if (intent.toolKinds.length === 0) return fail("codex.hook.unsupported", "Codex tool hooks require at least one portable tool kind.", intent.id);
      const matchers = intent.toolKinds.map(toolMatcher);
      const unsupported = matchers.find((matcher) => !matcher.ok);
      if (unsupported !== undefined && !unsupported.ok) return unsupported;
      const event = intent.lifecycle === "before-tool" ? "PreToolUse" : "PostToolUse";
      return success(matchers.flatMap((matcher) => matcher.ok ? [{ event, matcher: matcher.value }] : []));
    }
  }
}

function toolMatcher(kind: CanonicalHookIntent["toolKinds"][number]): Result<string> {
  switch (kind) {
    case "shell": return success("^Bash$");
    case "file-write": return success("^(?:apply_patch|Edit|Write)$");
    case "mcp": return success("^mcp__.*");
    case "file-read": return fail("codex.hook.unsupported", "Codex exposes no stable generic file-read tool matcher.", kind);
  }
}

function renderMcp(servers: readonly PluginMcpServer[]): Result<JsonValue | undefined> {
  if (servers.length === 0) return success(undefined);
  const entries: Record<string, JsonValue> = {};
  for (const [index, server] of servers.entries()) {
    const name = server.name ?? `server-${index + 1}`;
    if (entries[name] !== undefined) return fail("codex.mcp.duplicate", "Codex MCP server names must be unique.", name);
    switch (server.transport) {
      case "stdio": entries[name] = { command: server.command, ...(server.args === undefined ? {} : { args: server.args }), ...(server.cwd === undefined ? {} : { cwd: server.cwd }) }; break;
      case "streamable-http":
      case "sse": return fail("codex.mcp.unsupported", "Pinned Codex plugin MCP payloads do not define a portable remote transport shape.", name);
      case "config-path": return fail("codex.mcp.unsupported", "Codex payloads cannot inline an opaque MCP config-path declaration.", name);
    }
  }
  return success({ mcp_servers: entries });
}

function validateManifest(value: unknown, paths: ReadonlySet<string>): readonly Diagnostic[] {
  if (!isRecord(value)) return [diagnostic("codex.manifest.invalid", "Codex manifest must be an object.", MANIFEST_PATH)];
  const allowed = ["name", "version", "description", "skills", "hooks", "mcpServers"];
  const diagnostics = Object.keys(value).filter((key) => !allowed.includes(key)).map((key) => diagnostic("codex.manifest.unknown_field", "Unknown Codex manifest field.", key));
  if (typeof value["name"] !== "string" || !NAME.test(value["name"])) diagnostics.push(diagnostic("codex.manifest.name", "Codex manifest name is invalid.", "name"));
  if (typeof value["version"] !== "string" || !SEMVER.test(value["version"])) diagnostics.push(diagnostic("codex.manifest.version", "Codex manifest version must be semantic.", "version"));
  const components: readonly (readonly [string, string, boolean])[] = [
    ["skills", "./skills/", [...paths].some((path) => path.startsWith("skills/"))],
    ["hooks", `./${HOOKS_PATH}`, paths.has(HOOKS_PATH)],
    ["mcpServers", `./${MCP_PATH}`, paths.has(MCP_PATH)],
  ];
  for (const [field, expected, present] of components) {
    if (present ? value[field] !== expected : value[field] !== undefined) diagnostics.push(diagnostic("codex.manifest.component", "Codex component declaration does not match payload contents.", field));
  }
  return diagnostics;
}

function validateHooks(result: Result<unknown>): readonly Diagnostic[] {
  if (!result.ok) return result.diagnostics;
  if (!isRecord(result.value) || !isRecord(result.value["hooks"])) return [diagnostic("codex.hooks.invalid", "Codex hooks config must contain a hooks object.", HOOKS_PATH)];
  const events = new Set(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]);
  return Object.entries(result.value["hooks"]).flatMap(([event, groups]) => {
    if (!events.has(event) || !Array.isArray(groups)) return [diagnostic("codex.hooks.event", "Unsupported Codex hook event.", event)];
    return groups.flatMap((group) => {
      if (!isRecord(group) || !Array.isArray(group["hooks"]) || (group["matcher"] !== undefined && typeof group["matcher"] !== "string")) return [diagnostic("codex.hooks.group", "Codex hook matcher group is invalid.", event)];
      return group["hooks"].flatMap((entry) => !isRecord(entry) || entry["type"] !== "command" || typeof entry["command"] !== "string" || entry["command"].length === 0
        ? [diagnostic("codex.hooks.entry", "Codex command hook is invalid.", event)] : []);
    });
  });
}

function validateMcp(result: Result<unknown>): readonly Diagnostic[] {
  if (!result.ok) return result.diagnostics;
  if (!isRecord(result.value) || !isRecord(result.value["mcp_servers"])) return [diagnostic("codex.mcp.invalid", "Codex MCP config must contain mcp_servers.", MCP_PATH)];
  return Object.entries(result.value["mcp_servers"]).flatMap(([name, server]) => !isRecord(server) || typeof server["command"] !== "string"
    ? [diagnostic("codex.mcp.server", "Codex MCP server must define a command.", name)] : []);
}

function parseJson(bundle: VendorBundle, path: string): Result<unknown> {
  const file = bundle.files.find((entry) => entry.path === path);
  if (file === undefined) return fail("codex.payload.missing", "Required Codex payload file is missing.", path);
  try { return success(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.content)) as unknown); }
  catch { return fail("codex.json.invalid", "Codex JSON payload is invalid UTF-8 JSON.", path); }
}

function decodeText(file: PayloadFile): Result<string> {
  try { return success(new TextDecoder("utf-8", { fatal: true }).decode(file.content)); }
  catch { return fail("codex.text.invalid", "Codex text payload is not UTF-8.", file.path); }
}

function pluginName(name: string): string { const slash = name.lastIndexOf("/"); return slash === -1 ? name : name.slice(slash + 1); }
function fail(code: string, message: string, path?: string): Result<never> { return failure(diagnostic(code, message, path)); }
function diagnostic(code: string, message: string, path?: string): Diagnostic { return { severity: "error", code, message, ...(path === undefined ? {} : { path }) }; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
