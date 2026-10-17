import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { McpProtocol, McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { randomUUID } from "node:crypto";

import packageJson from "../../package.json" with { type: "json" };
import * as GlobalMcpManager from "./GlobalMcpManager.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import { HarnessToolkit } from "./toolkits/harness/tools.ts";
import { HarnessToolkitHandlersLive } from "./toolkits/harness/handlers.ts";
import { InteractionToolkitHandlersLive } from "./toolkits/interaction/handlers.ts";
import { InteractionToolkit } from "./toolkits/interaction/tools.ts";
import {
  PreviewSnapshotToolkitHandlersLive,
  PreviewStandardToolkitHandlersLive,
} from "./toolkits/preview/handlers.ts";
import {
  PreviewSnapshotTool,
  PreviewSnapshotToolkit,
  PreviewStandardToolkit,
} from "./toolkits/preview/tools.ts";

const unauthorized = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mcp_credential",
    message: "A valid provider-scoped MCP bearer credential is required.",
  },
  {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": "Bearer",
    },
  },
);

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

export const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

const makeMcpAuthMiddleware = McpSessionRegistry.McpSessionRegistry.pipe(
  Effect.map(
    (registry): McpAuthMiddleware =>
      Effect.fn("McpHttpServer.authenticateRequest")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const authorization = request.headers.authorization;
        const token =
          authorization?.startsWith("Bearer ") === true
            ? authorization.slice("Bearer ".length).trim()
            : "";
        const invocation = yield* registry.resolve(token);
        if (!invocation) {
          // Without this the only symptom of a dead credential is the agent
          // quietly losing the whole `t3-code` toolkit for the rest of its
          // session, with nothing on the server to explain why.
          yield* Effect.logWarning("rejected MCP request with an unusable credential", {
            reason: token.length === 0 ? "missing_bearer_token" : "unknown_or_expired_token",
          });
          return unauthorized;
        }
        return yield* httpEffect.pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.map(normalizeMcpHttpResponse),
        );
      }),
  ),
  Effect.withSpan("McpHttpServer.makeAuthMiddleware"),
);

const McpAuthMiddlewareLive = HttpRouter.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(makeMcpAuthMiddleware).layer;

type GlobalMcpSession = {
  readonly threadId: string;
  readonly providerSessionId: string;
};

class GlobalMcpGatewayState extends Context.Service<
  GlobalMcpGatewayState,
  {
    readonly create: (scope: McpInvocationContext.McpInvocationScope) => string;
    readonly get: (sessionId: string) => GlobalMcpSession | undefined;
    readonly remove: (sessionId: string) => void;
  }
>()("t3/mcp/McpHttpServer/GlobalMcpGatewayState") {}

const GlobalMcpGatewayStateLive = Layer.effect(
  GlobalMcpGatewayState,
  Effect.sync(() => {
    const sessions = new Map<string, GlobalMcpSession>();
    return GlobalMcpGatewayState.of({
      create: (scope) => {
        const sessionId = randomUUID();
        sessions.set(sessionId, {
          threadId: scope.threadId,
          providerSessionId: scope.providerSessionId,
        });
        return sessionId;
      },
      get: (sessionId) => sessions.get(sessionId),
      remove: (sessionId) => {
        sessions.delete(sessionId);
      },
    });
  }),
);

const globalMcpForbidden = HttpServerResponse.jsonUnsafe(
  {
    error: "global_mcp_capability_required",
    message: "This credential is not allowed to use the global MCP gateway.",
  },
  { status: 403 },
);

const globalMcpBadRequest = (message: string) =>
  HttpServerResponse.jsonUnsafe(
    { error: "invalid_mcp_request", message },
    { status: 400 },
  );

const globalMcpSessionResponse = (
  sessionId: string,
  body: unknown,
  status = 200,
) =>
  HttpServerResponse.jsonUnsafe(
    body,
    {
      status,
      headers: {
        "mcp-session-id": sessionId,
        "cache-control": "no-store",
      },
    },
  );

const globalMcpRpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const scopeMatchesSession = (
  session: GlobalMcpSession | undefined,
  scope: McpInvocationContext.McpInvocationScope,
) =>
  session !== undefined &&
  session.threadId === scope.threadId &&
  session.providerSessionId === scope.providerSessionId;

const isGlobalMcpInvocation = (
  scope: McpInvocationContext.McpInvocationScope,
): boolean => scope.capabilities.has("global-mcp");

const globalMcpPostRoute = HttpRouter.add(
  "POST",
  "/mcp/global",
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (!isGlobalMcpInvocation(invocation)) return globalMcpForbidden;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const gatewayState = yield* GlobalMcpGatewayState;
    const manager = yield* GlobalMcpManager.GlobalMcpManager;
    const payload = yield* request.json.pipe(Effect.orElseSucceed(() => undefined));
    if (payload === undefined || typeof payload !== "object" || payload === null) {
      return globalMcpBadRequest("A JSON-RPC request body is required.");
    }

    const message = payload as {
      readonly id?: unknown;
      readonly method?: unknown;
      readonly params?: unknown;
    };
    const method = typeof message.method === "string" ? message.method : undefined;
    if (!method) return globalMcpBadRequest("A JSON-RPC method is required.");

    if (method === "initialize") {
      const sessionId = gatewayState.create(invocation);
      return globalMcpSessionResponse(sessionId, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "SealCode Global MCP", version: packageJson.version },
        },
      });
    }

    const sessionId = request.headers["mcp-session-id"];
    if (!sessionId) return globalMcpBadRequest("mcp-session-id is required.");
    const session = gatewayState.get(sessionId);
    if (!scopeMatchesSession(session, invocation)) {
      return HttpServerResponse.jsonUnsafe(
        globalMcpRpcError(message.id, -32001, "Unknown or unauthorized MCP session."),
        { status: 404 },
      );
    }

    if (method === "notifications/initialized") {
      return HttpServerResponse.empty({ status: 202 });
    }
    if (method === "ping") {
      return globalMcpSessionResponse(sessionId, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {},
      });
    }
    if (method === "tools/list") {
      const catalog = yield* manager.getCatalog;
      return globalMcpSessionResponse(sessionId, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
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
        },
      });
    }
    if (method === "tools/call") {
      const params =
        typeof message.params === "object" && message.params !== null
          ? (message.params as { readonly name?: unknown; readonly arguments?: unknown })
          : undefined;
      if (typeof params?.name !== "string") {
        return globalMcpSessionResponse(
          sessionId,
          globalMcpRpcError(message.id, -32602, "tools/call requires a tool name."),
        );
      }
      const argumentsValue =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      const result = yield* manager.callTool({
        scope: invocation,
        canonicalToolName: params.name,
        arguments: argumentsValue,
      });
      return globalMcpSessionResponse(sessionId, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result,
      });
    }

    return globalMcpSessionResponse(
      sessionId,
      globalMcpRpcError(message.id, -32601, "Method not found."),
    );
  }),
);

const globalMcpGetRoute = HttpRouter.add(
  "GET",
  "/mcp/global",
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (!isGlobalMcpInvocation(invocation)) return globalMcpForbidden;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const sessionId = request.headers["mcp-session-id"];
    const gatewayState = yield* GlobalMcpGatewayState;
    if (!sessionId || !scopeMatchesSession(gatewayState.get(sessionId), invocation)) {
      return HttpServerResponse.empty({ status: 404 });
    }
    const manager = yield* GlobalMcpManager.GlobalMcpManager;
    const encoder = new TextEncoder();
    const connected = encoder.encode(
      `: connected\n\nevent: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      })}\n\n`,
    );
    return HttpServerResponse.stream(
      Stream.concat(
        Stream.make(connected),
        manager.streamChanges.pipe(
          Stream.map(() =>
            encoder.encode(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/tools/list_changed",
              })}\n\n`,
            ),
          ),
        ),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "mcp-session-id": sessionId,
        },
      },
    );
  }),
);

const globalMcpDeleteRoute = HttpRouter.add(
  "DELETE",
  "/mcp/global",
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (!isGlobalMcpInvocation(invocation)) return globalMcpForbidden;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const sessionId = request.headers["mcp-session-id"];
    if (!sessionId) return globalMcpBadRequest("mcp-session-id is required.");
    const gatewayState = yield* GlobalMcpGatewayState;
    if (!scopeMatchesSession(gatewayState.get(sessionId), invocation)) {
      return HttpServerResponse.empty({ status: 404 });
    }
    gatewayState.remove(sessionId);
    return HttpServerResponse.empty({ status: 204 });
  }),
);

const GlobalMcpGatewayRoutesLive = Layer.mergeAll(
  globalMcpPostRoute,
  globalMcpGetRoute,
  globalMcpDeleteRoute,
).pipe(
  Layer.provide(McpAuthMiddlewareLive),
);

const GlobalMcpGatewayRoutesWithStateLive = HttpRouter.provideRequest(
  GlobalMcpGatewayStateLive,
)(GlobalMcpGatewayRoutesLive);

const previewSnapshotFailure = <E>(cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
    return Effect.failCause(cause).pipe(Effect.orDie);
  }
  const failures = cause.reasons.filter(Cause.isFailReason);
  const firstFailure = failures[0]?.error;
  const errorTag =
    typeof firstFailure === "object" &&
    firstFailure !== null &&
    "_tag" in firstFailure &&
    typeof firstFailure._tag === "string"
      ? firstFailure._tag
      : "PreviewSnapshotError";
  const result = new McpSchema.CallToolResult({
    isError: true,
    structuredContent: {
      error: {
        _tag: errorTag,
        operation: "snapshot",
        failureCount: failures.length,
      },
    },
    content: [{ type: "text", text: "Preview snapshot failed." }],
  });
  return Effect.logWarning("preview snapshot failed", {
    operation: "snapshot",
    errorTag,
    failureCount: failures.length,
  }).pipe(Effect.as(result));
};

const registerPreviewSnapshot = Effect.fn("McpHttpServer.registerPreviewSnapshot")(function* () {
  const server = yield* McpServer.McpServer;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const built = yield* PreviewSnapshotToolkit;
  const tool = PreviewSnapshotTool;
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        ...Context.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined,
        ),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return built.handle("preview_snapshot", payload).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.matchCauseEffect({
            onFailure: previewSnapshotFailure,
            onSuccess: ({ encodedResult }) => {
              const snapshot = encodedResult as {
                readonly screenshot: {
                  readonly mimeType: "image/png";
                  readonly data: string;
                  readonly width: number;
                  readonly height: number;
                };
                readonly [key: string]: unknown;
              };
              const { screenshot, ...page } = snapshot;
              const metadata = {
                ...page,
                screenshot: {
                  mimeType: screenshot.mimeType,
                  width: screenshot.width,
                  height: screenshot.height,
                },
              };
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: metadata,
                  content: [
                    { type: "text", text: JSON.stringify(metadata) },
                    {
                      type: "image",
                      data: new Uint8Array(Buffer.from(screenshot.data, "base64")),
                      mimeType: screenshot.mimeType,
                    },
                  ],
                }),
              );
            },
          }),
        );
      }),
  });
});

const PreviewStandardToolkitRegistrationLive = McpServer.toolkit(PreviewStandardToolkit).pipe(
  Layer.provide(PreviewStandardToolkitHandlersLive),
);

const PreviewSnapshotRegistrationLive = Layer.effectDiscard(registerPreviewSnapshot()).pipe(
  Layer.provide(PreviewSnapshotToolkitHandlersLive),
);

const HarnessToolkitRegistrationLive = McpServer.toolkit(HarnessToolkit).pipe(
  Layer.provide(HarnessToolkitHandlersLive),
);

export const PreviewToolkitRegistrationLive = Layer.mergeAll(
  PreviewStandardToolkitRegistrationLive,
  PreviewSnapshotRegistrationLive,
  HarnessToolkitRegistrationLive,
);

const McpTransportLive = McpServer.layerHttp({
  name: "SealCode",
  version: packageJson.version,
  path: "/mcp",
  protocols: [McpProtocol.v2025_06_18],
}).pipe(Layer.provide(McpAuthMiddlewareLive));

const InteractionTransportLive = Layer.fresh(
  McpServer.layerHttp({
    name: "SealCode Interaction",
    version: packageJson.version,
    path: "/mcp/interaction",
    protocols: [McpProtocol.v2025_06_18],
  }),
).pipe(Layer.provide(McpAuthMiddlewareLive));

export const InteractionToolkitRegistrationLive = Layer.effectDiscard(
  McpServer.registerToolkit(InteractionToolkit),
).pipe(Layer.provide(InteractionToolkitHandlersLive));

const InteractionMcpLive = InteractionToolkitRegistrationLive.pipe(
  Layer.provide(InteractionTransportLive),
);

export const layer = Layer.mergeAll(
  PreviewToolkitRegistrationLive.pipe(Layer.provideMerge(McpTransportLive)),
  InteractionMcpLive,
  GlobalMcpGatewayRoutesWithStateLive,
);
