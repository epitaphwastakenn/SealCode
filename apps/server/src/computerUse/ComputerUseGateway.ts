import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ComputerUseChannel from "./ComputerUseChannel.ts";
import { callComputerUseTool, listComputerUseTools } from "./ComputerUseTools.ts";

/**
 * Its own endpoint rather than a t3-code toolkit, so providers name the tools
 * `mcp__computer-use__*` as Claude's desktop app does, and so the tool list can
 * follow the Settings toggle without a provider restart.
 */
export const COMPUTER_USE_GATEWAY_PATH = "/mcp/computer-use";
const SUPPORTED_PROTOCOL_VERSIONS: ReadonlyArray<string> = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** Provider instance ids are user-chosen, so this only recognizes the common drivers. */
const agentNameFor = (providerInstanceId: string) =>
  /claude/iu.test(providerInstanceId)
    ? "Claude"
    : /codex/iu.test(providerInstanceId)
      ? "Codex"
      : "The agent";

const forbidden = HttpServerResponse.jsonUnsafe(
  {
    error: "computer_use_unavailable",
    message: "Computer use is only available to agents in a SealCode thread that was granted it.",
  },
  { status: 403 },
);

const threadCaller = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  return invocation.thread !== undefined && invocation.capabilities.has("computer-use")
    ? invocation.thread
    : undefined;
});

const isEnabled = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  return yield* settings.getSettings.pipe(
    Effect.map((current) => current.computerUse.enabled),
    // An unreadable settings file must not hand out the mouse and keyboard.
    Effect.orElseSucceed(() => false),
  );
});

const post = HttpRouter.add(
  "POST",
  COMPUTER_USE_GATEWAY_PATH,
  Effect.gen(function* () {
    const thread = yield* threadCaller;
    if (thread === undefined) return forbidden;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const channel = yield* ComputerUseChannel.ComputerUseChannel;
    const payload = yield* request.json.pipe(Effect.orElseSucceed(() => undefined));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return HttpServerResponse.jsonUnsafe(rpcError(null, -32600, "A JSON-RPC body is required."), {
        status: 400,
      });
    }
    const message = payload as {
      readonly id?: unknown;
      readonly method?: unknown;
      readonly params?: unknown;
    };
    const reply = (result: unknown) =>
      HttpServerResponse.jsonUnsafe(
        { jsonrpc: "2.0", id: message.id ?? null, result },
        { headers: { "cache-control": "no-store" } },
      );

    switch (message.method) {
      case "initialize": {
        const requested = (message.params as { readonly protocolVersion?: unknown } | undefined)
          ?.protocolVersion;
        return reply({
          protocolVersion:
            typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "SealCode Computer Use", version: packageJson.version },
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: listComputerUseTools({ channel, enabled: yield* isEnabled }) });
      case "tools/call": {
        const params =
          typeof message.params === "object" && message.params !== null
            ? (message.params as { readonly name?: unknown; readonly arguments?: unknown })
            : undefined;
        if (typeof params?.name !== "string") {
          return HttpServerResponse.jsonUnsafe(
            rpcError(message.id, -32602, "tools/call requires a tool name."),
          );
        }
        return reply(
          yield* callComputerUseTool({
            channel,
            enabled: yield* isEnabled,
            threadId: thread.threadId,
            agentName: agentNameFor(thread.providerInstanceId),
            name: params.name,
            arguments: params.arguments,
          }),
        );
      }
      default:
        return message.id === undefined
          ? HttpServerResponse.empty({ status: 202 })
          : HttpServerResponse.jsonUnsafe(rpcError(message.id, -32601, "Method not found."));
    }
  }),
);

// Streamable HTTP clients probe GET for server-initiated messages; this server sends none.
const get = HttpRouter.add(
  "GET",
  COMPUTER_USE_GATEWAY_PATH,
  Effect.succeed(HttpServerResponse.empty({ status: 405 })),
);

const del = HttpRouter.add(
  "DELETE",
  COMPUTER_USE_GATEWAY_PATH,
  Effect.gen(function* () {
    return (yield* threadCaller) === undefined
      ? forbidden
      : HttpServerResponse.empty({ status: 204 });
  }),
);

/** Needs `McpInvocationContext`, which McpHttpServer's auth middleware provides per request. */
export const layerRoutes = Layer.mergeAll(post, get, del);
