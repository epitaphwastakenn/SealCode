import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as GlobalMcpManager from "./GlobalMcpManager.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";

/**
 * Providers connect to the user's configured MCP servers through this one endpoint instead of
 * each launching its own copy, so a stdio server runs once and every thread shares it. Tools keep
 * the `mcp__<server>__<tool>` names from `GlobalMcpManager`'s catalog; the catalog changes as
 * servers come and go, which `McpServer`'s fixed toolkit registration cannot express, so this
 * speaks the small JSON-RPC subset directly. It assigns no session id: every request carries the
 * thread's credential, so there is no state to keep.
 */
const GATEWAY_PATH = "/mcp/global";
const SUPPORTED_PROTOCOL_VERSIONS: ReadonlyArray<string> = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const LIST_CHANGED_NOTIFICATION = { jsonrpc: "2.0", method: "notifications/tools/list_changed" };

const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const badRequest = (message: string) =>
  HttpServerResponse.jsonUnsafe({ error: "invalid_mcp_request", message }, { status: 400 });

/** Only agents SealCode launched may call the user's servers; OAuth clients have no thread. */
const forbidden = HttpServerResponse.jsonUnsafe(
  {
    error: "global_mcp_thread_required",
    message: "The global MCP gateway is only available to agents running inside a SealCode thread.",
  },
  { status: 403 },
);

const encodeEvent = (message: unknown) =>
  new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);

const post = HttpRouter.add(
  "POST",
  GATEWAY_PATH,
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (invocation.thread === undefined) return forbidden;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const manager = yield* GlobalMcpManager.GlobalMcpManager;
    const payload = yield* request.json.pipe(Effect.orElseSucceed(() => undefined));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return badRequest("A JSON-RPC request body is required.");
    }

    const message = payload as {
      readonly id?: unknown;
      readonly method?: unknown;
      readonly params?: unknown;
    };
    if (typeof message.method !== "string") return badRequest("A JSON-RPC method is required.");
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
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "SealCode Global MCP", version: packageJson.version },
        });
      }
      case "ping":
        return reply({});
      case "tools/list": {
        const catalog = yield* manager.getCatalog;
        return reply({
          tools: catalog.tools.map((entry) => ({
            name: entry.canonicalName,
            title: entry.tool.title,
            description: entry.tool.description,
            inputSchema: entry.tool.inputSchema,
            outputSchema: entry.tool.outputSchema,
            annotations: entry.tool.annotations,
            execution: entry.tool.execution,
            icons: entry.tool.icons,
            _meta: {
              ...entry.tool._meta,
              sealcode: {
                serverId: entry.serverId,
                serverDisplayName: entry.serverDisplayName,
                upstreamToolName: entry.upstreamToolName,
              },
            },
          })),
        });
      }
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
        const result = yield* manager.callTool({
          scope: invocation,
          canonicalToolName: params.name,
          arguments:
            typeof params.arguments === "object" && params.arguments !== null
              ? (params.arguments as Record<string, unknown>)
              : {},
        });
        return reply(result);
      }
      default:
        // Notifications carry no id and expect no body.
        return message.id === undefined
          ? HttpServerResponse.empty({ status: 202 })
          : HttpServerResponse.jsonUnsafe(rpcError(message.id, -32601, "Method not found."));
    }
  }),
);

const get = HttpRouter.add(
  "GET",
  GATEWAY_PATH,
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (invocation.thread === undefined) return forbidden;
    const manager = yield* GlobalMcpManager.GlobalMcpManager;
    return HttpServerResponse.stream(
      Stream.concat(
        Stream.make(new TextEncoder().encode(": connected\n\n")),
        manager.streamChanges.pipe(Stream.map(() => encodeEvent(LIST_CHANGED_NOTIFICATION))),
      ),
      {
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache", connection: "keep-alive" },
      },
    );
  }),
);

const del = HttpRouter.add(
  "DELETE",
  GATEWAY_PATH,
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    return invocation.thread === undefined ? forbidden : HttpServerResponse.empty({ status: 204 });
  }),
);

/** Needs `McpInvocationContext`, which McpHttpServer's auth middleware provides per request. */
export const layerRoutes = Layer.mergeAll(post, get, del);
