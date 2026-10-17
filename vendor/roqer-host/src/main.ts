import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { BlenderWorker } from "@roqer/apps/desktop/runtime/blender-worker";
import {
  blenderToolDefinition,
  parseBlenderToolInput,
} from "@roqer/apps/desktop/runtime/blender-tool";
import {
  createIconToolRunner,
  iconToolDefinition,
  ICON_TOOL_NAME,
} from "@roqer/apps/desktop/runtime/icon-tool";
import { openSkillLibrary } from "@roqer/apps/desktop/runtime/skill-library";
import {
  createSkillToolRunner,
  skillToolDefinition,
  SKILL_TOOL_NAME,
  type SkillToolRunner,
} from "@roqer/apps/desktop/runtime/skill-tool";
import { uploadAssets } from "@roqer/apps/desktop/runtime/upload-assets";
import type { McpCallOptions, McpToolOutcome } from "@roqer/apps/desktop/runtime/mcp-types";
import { BLENDER_TOOL_NAME } from "@roqer/apps/desktop/shared/blender";
import {
  MAX_UPLOADS,
  UPLOAD_ASSETS_OPERATION,
} from "@roqer/apps/desktop/shared/gateway-operations";
import { TOOL_RISK, timeoutForTool } from "@roqer/apps/desktop/shared/mcp-tools";

import { BridgeSupervisor } from "./bridge";
import {
  boundResult,
  failedOutcome,
  isRecord,
  outcomeFromResult,
  resultFromOutcome,
} from "./outcome";
import {
  prepareCall,
  SCRIPT_MUTATIONS,
  verifyScriptWrite,
  widenSetScriptSourceSchema,
} from "./policies";

type JsonRecord = Record<string, unknown>;

const STATUS_TOOL_NAME = "get_bridge_status";
const SCOPE_META_KEY = "sealcode/threadId";
const MAX_SCOPES = 64;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function requiredFlag(name: string): string {
  const value = flag(name);
  if (value === undefined || value.trim() === "") {
    process.stderr.write(`roqer-host: ${name} is required\n`);
    process.exit(2);
  }
  return path.resolve(value);
}

const bridgeEntry = requiredFlag("--bridge");
const pluginPath = requiredFlag("--plugin");
const agentRoot = requiredFlag("--agent");
const blenderExecutable = flag("--blender");
const blenderJobsRoot = flag("--blender-jobs");
const bridgeVersion = (() => {
  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(path.dirname(bridgeEntry), "..", "package.json"), "utf8"),
    );
    return isRecord(manifest) && typeof manifest.version === "string"
      ? manifest.version
      : undefined;
  } catch {
    return undefined;
  }
})();
const bridgePort = Number(process.env.ROBLOX_STUDIO_PORT ?? "58741") || 58741;

const log = (line: string) => process.stderr.write(`${line}\n`);

/** Lines worth SealCode's log; the rest stays in the bridge's own recent log for status. */
const worthLogging = (line: string) =>
  line.startsWith("[roqer-host]") ||
  line.startsWith("[install-plugin]") ||
  line.includes("[plugin-version-rejected]");

const bridge = new BridgeSupervisor({
  command: process.execPath,
  args: [bridgeEntry, "--auto-install-plugin", "--plugin-path", pluginPath],
  env: process.env,
  onLog: (line) => {
    if (worthLogging(line)) log(line);
  },
  onToolsChanged: () => void server.sendToolListChanged().catch(() => undefined),
});

const library = await openSkillLibrary(path.join(agentRoot, "skills"));
const iconRunner = createIconToolRunner(library);

/** One skill cache per SealCode thread: a repeat load inside a conversation returns a pointer. */
const skillRunners = new Map<string, SkillToolRunner>();
function skillRunnerFor(scope: string): SkillToolRunner {
  let runner = skillRunners.get(scope);
  if (runner === undefined) {
    runner = createSkillToolRunner(library);
    skillRunners.set(scope, runner);
    if (skillRunners.size > MAX_SCOPES) {
      const oldest = skillRunners.keys().next().value;
      if (oldest !== undefined) skillRunners.delete(oldest);
    }
  } else {
    skillRunners.delete(scope);
    skillRunners.set(scope, runner);
  }
  return runner;
}

/** The bridge's catalog as of the build, so the list is answered before the bridge is up. */
function readBundledTools(): Tool[] | undefined {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(path.dirname(bridgeEntry), "..", "tools.json"), "utf8"),
    );
    return Array.isArray(parsed) ? (parsed as Tool[]) : undefined;
  } catch {
    return undefined;
  }
}
const bundledTools = readBundledTools();

const RISK_TITLES: Record<string, string> = {
  read: "Reads Studio",
  mutation: "Changes the place (undoable)",
  irreversible: "Irreversible or runs code",
};

function presentBridgeTool(tool: Tool): Tool {
  const risk = Object.prototype.hasOwnProperty.call(TOOL_RISK, tool.name)
    ? TOOL_RISK[tool.name]
    : "irreversible";
  const { outputSchema: _structuredOutputIsCarriedAsText, ...rest } = tool;
  return {
    ...rest,
    inputSchema:
      tool.name === "set_script_source"
        ? (widenSetScriptSourceSchema(tool.inputSchema as JsonRecord) as Tool["inputSchema"])
        : tool.inputSchema,
    annotations: {
      ...tool.annotations,
      title: tool.annotations?.title ?? RISK_TITLES[risk ?? "irreversible"],
      readOnlyHint: risk === "read",
      destructiveHint: risk === "irreversible",
      openWorldHint:
        tool.name === "upload_asset" ||
        tool.name === "generate_model" ||
        tool.name === "search_assets",
    },
  };
}

const uploadAssetsTool: Tool = {
  name: UPLOAD_ASSETS_OPERATION,
  description:
    "Upload several local files to Roblox in one call, as upload_asset does one: every texture of a finished set at once. Each file is uploaded on its own; the result lists every file with its assetId and, for a Decal, its imageId. Publishes to the user's Roblox account and goes through moderation.",
  inputSchema: {
    type: "object",
    properties: {
      uploads: {
        type: "array",
        minItems: 1,
        maxItems: MAX_UPLOADS,
        items: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path of the file to upload." },
            assetType: { type: "string", enum: ["Decal", "Model", "Audio", "Animation", "Video"] },
            displayName: { type: "string", maxLength: 50 },
            description: { type: "string" },
          },
          required: ["filePath", "assetType", "displayName"],
          additionalProperties: false,
        },
      },
    },
    required: ["uploads"],
    additionalProperties: false,
  },
  annotations: {
    title: "Uploads to Roblox",
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
};

const statusTool: Tool = {
  name: STATUS_TOOL_NAME,
  description:
    "Report the Roblox Studio bridge's state: whether it is running, whether the Studio plugin was just updated (Studio must be restarted to load it), install problems, a Studio still running an older plugin, and which places are connected. Call it when Studio tools fail to reach Studio.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    title: "Bridge status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

function localTools(): Tool[] {
  const skill = skillToolDefinition(library);
  const icon = iconToolDefinition();
  return [
    {
      ...skill,
      inputSchema: skill.inputSchema as Tool["inputSchema"],
      annotations: { title: "Load a Roblox skill", readOnlyHint: true },
    },
    {
      ...icon,
      inputSchema: icon.inputSchema as Tool["inputSchema"],
      annotations: { title: "Resolve a UI icon", readOnlyHint: true },
    },
    uploadAssetsTool,
    ...(blenderExecutable === undefined
      ? []
      : [
          {
            ...blenderToolDefinition(),
            inputSchema: blenderToolDefinition().inputSchema as Tool["inputSchema"],
            annotations: {
              title: "Run a Blender job",
              readOnlyHint: false,
              destructiveHint: true,
              openWorldHint: false,
            },
          } satisfies Tool,
        ]),
    statusTool,
  ];
}

async function listTools(): Promise<Tool[]> {
  let upstream = bridge.tools ?? bundledTools;
  if (upstream === undefined) {
    await bridge.ready().catch(() => undefined);
    upstream = bridge.tools ?? [];
  }
  return [...upstream.map(presentBridgeTool), ...localTools()];
}

/** One bridge call as an outcome; a dead or hung bridge is a failed call, never a thrown one. */
async function callBridge(
  tool: string,
  args: JsonRecord,
  signal?: AbortSignal,
): Promise<McpToolOutcome> {
  const started = Date.now();
  let client;
  try {
    client = await bridge.ready();
  } catch (error) {
    return failedOutcome(
      `The Roblox Studio bridge is not running: ${error instanceof Error ? error.message : String(error)}`,
      "bridge_unavailable",
    );
  }
  try {
    const result = (await client.callTool({ name: tool, arguments: args }, undefined, {
      timeout: timeoutForTool(tool, args),
      ...(signal === undefined ? {} : { signal }),
    })) as CallToolResult;
    return outcomeFromResult(result, Date.now() - started);
  } catch (error) {
    if (signal?.aborted) return failedOutcome("The call was cancelled.", "aborted");
    return failedOutcome(error instanceof Error ? error.message : String(error));
  }
}

async function probeHealth(): Promise<unknown> {
  try {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok ? await response.json() : { reachable: false, httpStatus: response.status };
  } catch {
    return { reachable: false };
  }
}

async function bridgeStatus(): Promise<JsonRecord> {
  const health = await probeHealth();
  const instances = isRecord(health) && Array.isArray(health.instances) ? health.instances : [];
  if (instances.length > 0) bridge.clearRejection();
  const status = bridge.status();
  const servingVersion =
    isRecord(health) && typeof health.serverVersion === "string" ? health.serverVersion : undefined;
  return {
    bridge: { ...status, version: bridgeVersion, port: bridgePort },
    http: isRecord(health)
      ? {
          reachable: health.reachable !== false,
          ...(servingVersion === undefined ? {} : { serverVersion: servingVersion }),
          pluginConnected: health.pluginConnected === true,
          instances,
        }
      : { reachable: false },
    ...(servingVersion !== undefined &&
    bridgeVersion !== undefined &&
    servingVersion !== bridgeVersion
      ? {
          warning: `Another Roblox Studio bridge (v${servingVersion}) owns port ${bridgePort}; this one (v${bridgeVersion}) forwards to it. Close the other app's bridge so Studio talks to the matching version.`,
        }
      : {}),
    plugin: { path: pluginPath, version: bridgeVersion },
    blender:
      blenderExecutable === undefined
        ? { enabled: false }
        : { enabled: true, executable: blenderExecutable },
  };
}

const scopeOf = (meta: unknown): string => {
  const thread = isRecord(meta) ? meta[SCOPE_META_KEY] : undefined;
  return typeof thread === "string" && thread.length > 0 ? thread : "default";
};

const textResult = (text: string, ok = true): CallToolResult => ({
  content: [{ type: "text", text }],
  ...(ok ? {} : { isError: true }),
});

async function runBlender(
  args: JsonRecord,
  scope: string,
  signal: AbortSignal,
): Promise<CallToolResult> {
  if (blenderExecutable === undefined || blenderJobsRoot === undefined) {
    return textResult(
      "Blender is turned off in SealCode's Roblox settings, so the job did not run.",
      false,
    );
  }
  let parsed: { operation: string; args: JsonRecord };
  try {
    parsed = parseBlenderToolInput(args);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), false);
  }
  // Jobs continue only from earlier jobs of the same thread, as Roqer scopes them to a chat.
  const worker = new BlenderWorker({
    executable: blenderExecutable,
    jobsRoot: path.resolve(blenderJobsRoot),
    scope: createHash("sha256").update(scope).digest("hex").slice(0, 32),
  });
  const outcome = await worker.run(parsed.args, {
    signal,
    timeoutMs: timeoutForTool("run_blender_script"),
  } satisfies McpCallOptions);
  return resultFromOutcome(outcome);
}

async function callTool(
  name: string,
  args: JsonRecord,
  scope: string,
  signal: AbortSignal,
): Promise<CallToolResult> {
  switch (name) {
    case SKILL_TOOL_NAME:
      try {
        return textResult(await skillRunnerFor(scope)(args));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), false);
      }
    case ICON_TOOL_NAME:
      try {
        return textResult(await iconRunner(args));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), false);
      }
    case STATUS_TOOL_NAME:
      return textResult(JSON.stringify(await bridgeStatus(), null, 2));
    case UPLOAD_ASSETS_OPERATION: {
      const outcome = await uploadAssets(
        args,
        { signal, timeoutMs: timeoutForTool(UPLOAD_ASSETS_OPERATION) },
        (tool, toolArgs, options) => callBridge(tool, toolArgs, options?.signal ?? signal),
      ).catch((error: unknown) =>
        failedOutcome(error instanceof Error ? error.message : String(error)),
      );
      return resultFromOutcome(outcome);
    }
    case BLENDER_TOOL_NAME:
      return runBlender(args, scope, signal);
    default:
      break;
  }

  const studio = (tool: string, toolArgs: JsonRecord) => callBridge(tool, toolArgs, signal);
  const prepared = await prepareCall(name, args, studio, library);
  if (prepared.kind === "answer") return textResult(prepared.text, prepared.ok);
  const outcome = await callBridge(name, prepared.args, signal);
  const verification = SCRIPT_MUTATIONS.has(name)
    ? await verifyScriptWrite(prepared.args, outcome, studio)
    : undefined;
  const note = [prepared.note, verification]
    .filter((part): part is string => part !== undefined)
    .join("\n");
  const result = resultFromOutcome(outcome, note.length > 0 ? note : undefined);
  if (outcome.errorCode === "bridge_unavailable") {
    const status = bridge.status();
    if (status.pluginProblem !== undefined) {
      result.content.push({ type: "text", text: `Studio plugin problem: ${status.pluginProblem}` });
    }
  }
  return boundResult(result);
}

const server = new Server(
  { name: "roqer", title: "Roqer for Roblox Studio", version: bridgeVersion ?? "0.0.0" },
  {
    capabilities: { tools: { listChanged: true } },
    instructions:
      "Roblox Studio tools from Roqer. Call get_connected_instances before targeting a place when several are open, and get_bridge_status when Studio cannot be reached.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const args = isRecord(request.params.arguments) ? request.params.arguments : {};
  return callTool(request.params.name, args, scopeOf(request.params._meta), extra.signal);
});

const shutdown = async () => {
  await bridge.stop();
  process.exit(0);
};
process.stdin.on("end", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await server.connect(new StdioServerTransport());
bridge.start();
log(
  `[roqer-host] started (bridge v${bridgeVersion ?? "unknown"}, ${library.catalog.length} skills${blenderExecutable === undefined ? "" : ", Blender on"})`,
);
