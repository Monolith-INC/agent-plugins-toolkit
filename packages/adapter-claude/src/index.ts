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

export const CLAUDE_ADAPTER_VERSION = "1.0.0" as const;
export const CLAUDE_SCHEMA_VERSION = "claude-code-plugins-2026-08-10" as const;
export const CLAUDE_SCHEMA_EVIDENCE = Object.freeze([
  "https://code.claude.com/docs/en/plugins-reference",
  "https://code.claude.com/docs/en/hooks",
] as const);

const MANIFEST_PATH = ".claude-plugin/plugin.json";
const HOOKS_PATH = "hooks/hooks.json";
const MCP_PATH = ".mcp.json";
const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const claudeAdapter: VendorAdapter = Object.freeze({
  vendor: "claude",
  adapterVersion: CLAUDE_ADAPTER_VERSION,
  vendorSchemaVersion: CLAUDE_SCHEMA_VERSION,
  compile: compileClaudePayload,
  validate: validateClaudeBundle,
  planInstallation: planClaudeInstallation,
});

export function compileClaudePayload(plugin: CanonicalPlugin): Result<VendorBundleDraft> {
  const name = pluginName(plugin.manifest.name);
  if (!NAME.test(name)) return fail("claude.manifest.name", "Canonical name cannot map to a Claude Code plugin name.", "manifest.name");
  if (plugin.rules.length > 0) {
    return fail(
      "claude.rule.unsupported",
      "Claude Code plugins have no native rules component; standalone .claude/rules files are outside plugin payloads.",
      plugin.rules[0]?.id,
    );
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
    vendor: "claude",
    adapter: { version: CLAUDE_ADAPTER_VERSION, vendorSchemaVersion: CLAUDE_SCHEMA_VERSION },
    sourceDigest: plugin.sourceDigest,
    files: files.flatMap((result) => result.ok ? [result.value] : []),
  });
}

export function validateClaudeBundle(bundle: VendorBundle): readonly Diagnostic[] {
  const common = validateVendorBundle(bundle);
  if (common.length > 0) return common;
  const diagnostics: Diagnostic[] = [];
  if (bundle.manifest.vendor !== "claude" || bundle.manifest.adapter.version !== CLAUDE_ADAPTER_VERSION ||
      bundle.manifest.adapter.vendorSchemaVersion !== CLAUDE_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("claude.bundle.identity", "Bundle is not owned by this Claude adapter."));
  }
  const paths = new Set<string>(bundle.files.map((file) => file.path));
  const allowed = /^(?:\.claude-plugin\/plugin\.json|skills\/[^/]+\/SKILL\.md|hooks\/hooks\.json|\.mcp\.json)$/;
  for (const file of bundle.files) {
    if (!allowed.test(file.path)) diagnostics.push(diagnostic("claude.payload.path", "Unexpected Claude payload path.", file.path));
  }
  const manifest = parseJson(bundle, MANIFEST_PATH);
  if (!manifest.ok) diagnostics.push(...manifest.diagnostics);
  else diagnostics.push(...validateManifest(manifest.value, paths));
  for (const file of bundle.files.filter((entry) => entry.path.startsWith("skills/"))) {
    const text = decodeText(file);
    if (!text.ok || !/^---\n[\s\S]*\n---\n/u.test(text.value)) diagnostics.push(diagnostic("claude.skill.invalid", "Claude Skills require YAML frontmatter.", file.path));
  }
  if (paths.has(HOOKS_PATH)) diagnostics.push(...validateHooks(parseJson(bundle, HOOKS_PATH)));
  if (paths.has(MCP_PATH)) diagnostics.push(...validateMcp(parseJson(bundle, MCP_PATH)));
  return diagnostics;
}

export function planClaudeInstallation(bundle: VendorBundle, _target: InstallTarget): Result<InstallPlan> {
  const diagnostics = validateClaudeBundle(bundle);
  if (diagnostics.length > 0) return failure(diagnostics[0] as Diagnostic, ...diagnostics.slice(1));
  const plan: InstallPlan = {
    plugin: bundle.manifest.plugin.name,
    version: bundle.manifest.plugin.version,
    vendor: "claude",
    bundleDigest: bundle.manifest.payloadDigest,
    writes: bundle.files.map((file) => ({ source: file.path, destination: file.path, mode: file.mode })),
  };
  const planDiagnostics = validateInstallPlan(plan, bundle);
  return planDiagnostics.length === 0 ? success(plan) : failure(planDiagnostics[0] as Diagnostic, ...planDiagnostics.slice(1));
}

type HookCommand = { readonly type: "command"; readonly command: string; readonly timeout?: number };
type HookGroup = { readonly matcher?: string; readonly hooks: readonly HookCommand[] };

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
      if (intent.toolKinds.length === 0) return fail("claude.hook.unsupported", "Claude tool hooks require at least one portable tool kind.", intent.id);
      const event = intent.lifecycle === "before-tool" ? "PreToolUse" : "PostToolUse";
      return success(intent.toolKinds.map((kind) => ({ event, matcher: toolMatcher(kind) })));
    }
  }
}

function toolMatcher(kind: CanonicalHookIntent["toolKinds"][number]): string {
  switch (kind) {
    case "shell": return "Bash";
    case "file-read": return "Read";
    case "file-write": return "Write|Edit";
    case "mcp": return "mcp__.*";
  }
}

function renderMcp(servers: readonly PluginMcpServer[]): Result<JsonValue | undefined> {
  if (servers.length === 0) return success(undefined);
  const entries: Record<string, JsonValue> = {};
  for (const [index, server] of servers.entries()) {
    const name = server.name ?? `server-${index + 1}`;
    if (entries[name] !== undefined) return fail("claude.mcp.duplicate", "Claude MCP server names must be unique.", name);
    switch (server.transport) {
      case "stdio":
        if (server.cwd !== undefined) return fail("claude.mcp.unsupported", "Claude plugin MCP declarations cannot preserve a portable working directory.", name);
        entries[name] = { command: server.command, ...(server.args === undefined ? {} : { args: server.args }) };
        break;
      case "streamable-http": entries[name] = { type: "http", url: server.url }; break;
      case "sse": entries[name] = { type: "sse", url: server.url }; break;
      case "config-path": return fail("claude.mcp.unsupported", "Claude payloads cannot inline an opaque MCP config-path declaration.", name);
    }
  }
  return success({ mcpServers: entries });
}

function validateManifest(value: unknown, paths: ReadonlySet<string>): readonly Diagnostic[] {
  if (!isRecord(value)) return [diagnostic("claude.manifest.invalid", "Claude manifest must be an object.", MANIFEST_PATH)];
  const allowed = ["name", "version", "description", "skills", "hooks", "mcpServers"];
  const diagnostics = Object.keys(value).filter((key) => !allowed.includes(key)).map((key) => diagnostic("claude.manifest.unknown_field", "Unknown Claude manifest field.", key));
  if (typeof value["name"] !== "string" || !NAME.test(value["name"])) diagnostics.push(diagnostic("claude.manifest.name", "Claude manifest name is invalid.", "name"));
  if (typeof value["version"] !== "string" || !SEMVER.test(value["version"])) diagnostics.push(diagnostic("claude.manifest.version", "Claude manifest version must be semantic.", "version"));
  const components: readonly (readonly [string, string, boolean])[] = [
    ["skills", "./skills/", [...paths].some((path) => path.startsWith("skills/"))],
    ["hooks", `./${HOOKS_PATH}`, paths.has(HOOKS_PATH)],
    ["mcpServers", `./${MCP_PATH}`, paths.has(MCP_PATH)],
  ];
  for (const [field, expected, present] of components) {
    if (present ? value[field] !== expected : value[field] !== undefined) diagnostics.push(diagnostic("claude.manifest.component", "Claude component declaration does not match payload contents.", field));
  }
  return diagnostics;
}

function validateHooks(result: Result<unknown>): readonly Diagnostic[] {
  if (!result.ok) return result.diagnostics;
  if (!isRecord(result.value) || !isRecord(result.value["hooks"])) return [diagnostic("claude.hooks.invalid", "Claude hooks config must contain a hooks object.", HOOKS_PATH)];
  const events = new Set(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]);
  return Object.entries(result.value["hooks"]).flatMap(([event, groups]) => {
    if (!events.has(event) || !Array.isArray(groups)) return [diagnostic("claude.hooks.event", "Unsupported Claude hook event.", event)];
    return groups.flatMap((group) => {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) return [diagnostic("claude.hooks.group", "Claude hook matcher group is invalid.", event)];
      return group["hooks"].flatMap((entry) => !isRecord(entry) || entry["type"] !== "command" || typeof entry["command"] !== "string" || entry["command"].length === 0
        ? [diagnostic("claude.hooks.entry", "Claude command hook is invalid.", event)] : []);
    });
  });
}

function validateMcp(result: Result<unknown>): readonly Diagnostic[] {
  if (!result.ok) return result.diagnostics;
  if (!isRecord(result.value) || !isRecord(result.value["mcpServers"])) return [diagnostic("claude.mcp.invalid", "Claude MCP config must contain mcpServers.", MCP_PATH)];
  return Object.entries(result.value["mcpServers"]).flatMap(([name, server]) => {
    if (!isRecord(server)) return [diagnostic("claude.mcp.server", "Claude MCP server must be an object.", name)];
    const command = typeof server["command"] === "string";
    const url = typeof server["url"] === "string";
    return command !== url ? [] : [diagnostic("claude.mcp.transport", "Claude MCP server must define exactly one command or URL.", name)];
  });
}

function parseJson(bundle: VendorBundle, path: string): Result<unknown> {
  const file = bundle.files.find((entry) => entry.path === path);
  if (file === undefined) return fail("claude.payload.missing", "Required Claude payload file is missing.", path);
  try { return success(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.content)) as unknown); }
  catch { return fail("claude.json.invalid", "Claude JSON payload is invalid UTF-8 JSON.", path); }
}

function decodeText(file: PayloadFile): Result<string> {
  try { return success(new TextDecoder("utf-8", { fatal: true }).decode(file.content)); }
  catch { return fail("claude.text.invalid", "Claude text payload is not UTF-8.", file.path); }
}

function pluginName(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

function fail(code: string, message: string, path?: string): Result<never> {
  return failure(diagnostic(code, message, path));
}

function diagnostic(code: string, message: string, path?: string): Diagnostic {
  return { severity: "error", code, message, ...(path === undefined ? {} : { path }) };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
