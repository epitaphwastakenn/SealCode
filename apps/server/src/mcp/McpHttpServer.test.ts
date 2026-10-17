import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, PreviewTabId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpProtocol, McpSchema, McpServer } from "effect/unstable/ai";
import { HttpBody, HttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";

import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as GlobalMcpManager from "./GlobalMcpManager.ts";
import * as McpInteractionBroker from "./McpInteractionBroker.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

const environmentId = EnvironmentId.make("environment-mcp-test");
const threadId = ThreadId.make("thread-mcp-test");
const tabId = PreviewTabId.make("tab-mcp-test");
const alternateTabId = PreviewTabId.make("tab-mcp-alternate");
const invocation = {
  environmentId,
  threadId,
  providerSessionId: "provider-session-mcp-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});
const TestLayer = McpHttpServer.PreviewToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
);

it("normalizes empty successful notification responses to accepted", () => {
  const notificationResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.text("", { status: 200, contentType: "application/json" }),
  );
  expect(notificationResponse.status).toBe(202);

  const resultResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id: 1, result: {} }),
  );
  expect(resultResponse.status).toBe(200);
});

it.effect("returns bounded structural preview snapshot failures", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const events = yield* broker.connect({
        clientId: "mcp-failure-client",
        environmentId,
      });
      yield* Stream.runForEach(events, (event) =>
        event.type === "connected"
          ? Effect.void
          : broker.respond({
              clientId: "mcp-failure-client",
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: false,
              error: {
                _tag: "PreviewAutomationExecutionError",
                message: "sensitive renderer failure",
                detail: { consoleOutput: "sensitive browser output" },
              },
            }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const snapshot = yield* server
        .callTool({ name: "preview_snapshot", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );

      expect(snapshot.isError).toBe(true);
      expect(snapshot.content).toEqual([{ type: "text", text: "Preview snapshot failed." }]);
      expect(snapshot.structuredContent).toEqual({
        error: {
          _tag: "PreviewAutomationExecutionError",
          operation: "snapshot",
          failureCount: 1,
        },
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("terminates HTTP MCP sessions with DELETE", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const serverLayer = McpServer.layerHttp({
        name: "MCP termination test",
        version: "1.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18],
      });
      yield* HttpRouter.serve(serverLayer, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;

      const initializeResponse = yield* httpClient.post("/mcp", {
        headers: { accept: "application/json, text/event-stream" },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1.0.0"}}}`,
          "application/json",
        ),
      });
      const sessionId = initializeResponse.headers["mcp-session-id"];
      expect(initializeResponse.status).toBe(200);
      expect(sessionId).not.toBeNull();

      const missingSessionResponse = yield* httpClient.del("/mcp");
      expect(missingSessionResponse.status).toBe(400);

      const unknownSessionResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": "unknown-session" },
      });
      expect(unknownSessionResponse.status).toBe(404);

      const terminateResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": sessionId! },
      });
      expect(terminateResponse.status).toBe(204);

      const reusedSessionResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}`,
          "application/json",
        ),
      });
      expect(reusedSessionResponse.status).toBe(404);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("authenticates and routes the dynamic global MCP gateway", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const globalInvocation: McpInvocationContext.McpInvocationScope = {
        ...invocation,
        providerSessionId: "global-provider-session",
        activeTurnId: "turn-1",
        capabilities: new Set(["global-mcp"]),
      };
      const previewOnlyInvocation: McpInvocationContext.McpInvocationScope = {
        ...invocation,
        capabilities: new Set(["preview"]),
      };
      const fakeRegistry = McpSessionRegistry.McpSessionRegistry.of({
        issue: ((_) => Effect.die("unused")) as McpSessionRegistry.McpSessionRegistryShape["issue"],
        resolve: (token) =>
          Effect.succeed(
            token === "global-token"
              ? globalInvocation
              : token === "preview-token"
                ? previewOnlyInvocation
                : undefined,
          ),
        touch: () => Effect.void,
        setActiveTurn: () => Effect.void,
        revokeProviderSession: () => Effect.void,
        revokeThread: () => Effect.void,
        revokeAll: Effect.void,
      });
      const catalog: GlobalMcpManager.McpToolCatalog = {
        tools: [
          {
            canonicalName: "mcp__roblox_studio__get_state",
            serverId: "roblox-studio",
            serverDisplayName: "Roblox Studio",
            upstreamToolName: "get_state",
            tool: {
              name: "get_state",
              description: "Read Studio state.",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true },
            },
          },
        ],
        byCanonicalName: new Map(),
      };
      let receivedInvocation: GlobalMcpManager.McpInvocation | undefined;
      const fakeManager = GlobalMcpManager.GlobalMcpManager.of({
        reload: Effect.void,
        reloadServer: () => Effect.void,
        getStatuses: Effect.succeed([]),
        getCatalog: Effect.succeed(catalog),
        callTool: (input) =>
          Effect.sync(() => {
            receivedInvocation = input;
            return {
              isError: false,
              content: [{ type: "text", text: "Studio is ready." }],
              structuredContent: { connected: true },
            };
          }),
        streamChanges: Stream.empty,
        streamStatusChanges: Stream.empty,
        close: Effect.void,
      });
      const routesWithoutManager = McpHttpServer.layer.pipe(
        Layer.provide(
          Layer.succeed(McpSessionRegistry.McpSessionRegistry, fakeRegistry),
        ),
        Layer.provide(PreviewAutomationBroker.layer),
        Layer.provide(McpInteractionBroker.layer),
      );
      const routesLayer = HttpRouter.provideRequest(
        Layer.succeed(GlobalMcpManager.GlobalMcpManager, fakeManager),
      )(routesWithoutManager);
      yield* HttpRouter.serve(routesLayer, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;
      const requestHeaders = {
        accept: "application/json, text/event-stream",
        authorization: "Bearer global-token",
        "content-type": "application/json",
      };

      const unauthorizedResponse = yield* httpClient.post("/mcp/global", {
        headers: { ...requestHeaders, authorization: "Bearer unknown-token" },
        body: HttpBody.text('{"jsonrpc":"2.0","id":1,"method":"ping"}', "application/json"),
      });
      expect(unauthorizedResponse.status).toBe(401);

      const forbiddenResponse = yield* httpClient.post("/mcp/global", {
        headers: { ...requestHeaders, authorization: "Bearer preview-token" },
        body: HttpBody.text(
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
          "application/json",
        ),
      });
      expect(forbiddenResponse.status).toBe(403);

      const initializeResponse = yield* httpClient.post("/mcp/global", {
        headers: requestHeaders,
        body: HttpBody.text(
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
          "application/json",
        ),
      });
      expect(initializeResponse.status).toBe(200);
      const sessionId = initializeResponse.headers["mcp-session-id"];
      expect(sessionId).toBeDefined();

      const streamResponse = yield* httpClient.get("/mcp/global", {
        headers: {
          ...requestHeaders,
          accept: "text/event-stream",
          "mcp-session-id": sessionId!,
        },
      });
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers["content-type"]).toContain("text/event-stream");
      const streamBody = yield* streamResponse.text;
      expect(streamBody).toContain(": connected");
      expect(streamBody).toContain("notifications/tools/list_changed");

      const listResponse = yield* httpClient.post("/mcp/global", {
        headers: { ...requestHeaders, "mcp-session-id": sessionId! },
        body: HttpBody.text(
          '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
          "application/json",
        ),
      });
      const listBody = yield* listResponse.json;
      expect(listResponse.status).toBe(200);
      expect(listBody).toMatchObject({
        result: {
          tools: [
            {
              name: "mcp__roblox_studio__get_state",
              _meta: {
                sealcode: {
                  serverId: "roblox-studio",
                  upstreamToolName: "get_state",
                },
              },
            },
          ],
        },
      });

      const callResponse = yield* httpClient.post("/mcp/global", {
        headers: { ...requestHeaders, "mcp-session-id": sessionId! },
        body: HttpBody.text(
          '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mcp__roblox_studio__get_state","arguments":{"place":"Test"}}}',
          "application/json",
        ),
      });
      expect(callResponse.status).toBe(200);
      expect(yield* callResponse.json).toMatchObject({
        result: {
          structuredContent: { connected: true },
        },
      });
      expect(receivedInvocation?.scope.threadId).toBe(threadId);
      expect(receivedInvocation?.scope.activeTurnId).toBe("turn-1");
      expect(receivedInvocation?.arguments).toEqual({ place: "Test" });

      const deleteResponse = yield* httpClient.del("/mcp/global", {
        headers: { authorization: "Bearer global-token", "mcp-session-id": sessionId! },
      });
      expect(deleteResponse.status).toBe(204);
    }),
  ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpServer.layerTest))),
);

it.effect("registers annotated tools and preserves authenticated request context", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const routedRequests: Array<{
        readonly operation: string;
        readonly tabId?: string | undefined;
      }> = [];
      const events = yield* broker.connect({
        clientId: "mcp-test-client",
        environmentId,
      });
      yield* Stream.runForEach(events, (event) => {
        if (event.type === "connected") return Effect.void;
        routedRequests.push(event.request);
        return broker.respond({
          clientId: "mcp-test-client",
          connectionId: event.connectionId,
          requestId: event.request.requestId,
          ok: true,
          result:
            event.request.operation === "snapshot"
              ? {
                  url: "http://example.test/",
                  title: "Example",
                  loading: false,
                  visibleText: "Example",
                  interactiveElements: [],
                  accessibilityTree: {},
                  consoleEntries: [],
                  networkEntries: [],
                  actionTimeline: [],
                  screenshot: {
                    mimeType: "image/png",
                    data: Buffer.from("png").toString("base64"),
                    width: 10,
                    height: 5,
                  },
                }
              : event.request.operation === "press"
                ? undefined
                : {
                    available: true,
                    visible: true,
                    tabId,
                    url: "http://example.test/",
                    title: "Example",
                    loading: false,
                  },
        });
      }).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const statusTool = server.tools.find(({ tool }) => tool.name === "preview_status");
      expect(statusTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(statusTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(statusTool?.tool.annotations?.destructiveHint).toBe(false);

      const snapshotTool = server.tools.find(({ tool }) => tool.name === "preview_snapshot");
      expect(snapshotTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(snapshotTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(snapshotTool?.tool.annotations?.openWorldHint).toBe(true);

      const clickTool = server.tools.find(({ tool }) => tool.name === "preview_click");
      expect(clickTool?.tool.annotations?.readOnlyHint).toBe(false);
      expect(clickTool?.tool.annotations?.destructiveHint).toBe(true);
      expect(clickTool?.tool.annotations?.openWorldHint).toBe(true);

      const navigateTool = server.tools.find(({ tool }) => tool.name === "preview_navigate");
      expect(navigateTool?.tool.annotations?.destructiveHint).toBe(false);
      expect(navigateTool?.tool.annotations?.openWorldHint).toBe(true);

      const status = yield* server
        .callTool({ name: "preview_status", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(status.isError).toBe(false);
      expect(status.structuredContent).toMatchObject({
        available: true,
        tabId,
      });

      const malformed = yield* server
        .callTool({ name: "preview_click", arguments: { selector: "" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.flip,
        );
      expect(malformed._tag).toBe("InvalidParams");

      const snapshot = yield* server
        .callTool({ name: "preview_snapshot", arguments: { tabId: alternateTabId } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(snapshot.isError).toBe(false);
      expect(snapshot.content.some((content) => content.type === "image")).toBe(true);
      expect(snapshot.structuredContent).toMatchObject({
        screenshot: { mimeType: "image/png", width: 10, height: 5 },
      });
      expect(routedRequests.find(({ operation }) => operation === "snapshot")?.tabId).toBe(
        alternateTabId,
      );

      const press = yield* server
        .callTool({ name: "preview_press", arguments: { key: "Enter" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(press.isError).toBe(false);
      expect(press.structuredContent).toBeNull();
      expect(press.content).toEqual([{ type: "text", text: "null" }]);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

const InteractionTestLayer = McpHttpServer.InteractionToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(McpInteractionBroker.layer.pipe(Layer.provide(NodeServices.layer))),
);

const interactionQuestion = {
  id: "implementation",
  header: "Implementation",
  question: "Which implementation should we use?",
  options: [
    { label: "Option A", description: "Use the existing helper." },
    { label: "Option B", description: "Write a new helper." },
  ],
};

it.effect("lists and invokes request_user_input only on the interaction toolkit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const previewServer = yield* McpServer.McpServer;
      expect(previewServer.tools.some(({ tool }) => tool.name === "request_user_input")).toBe(
        false,
      );
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("authenticates interaction calls against the registered Antigravity turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* McpInteractionBroker.McpInteractionBroker;
      const matchingInvocation = {
        ...invocation,
        providerInstanceId: ProviderInstanceId.make("antigravity"),
        providerSessionId: "antigravity-session",
        activeTurnId: "turn-1",
      };
      const _unregister = yield* broker.register(
        {
          threadId: matchingInvocation.threadId,
          providerSessionId: matchingInvocation.providerSessionId,
          providerInstanceId: matchingInvocation.providerInstanceId,
          turnId: "turn-1",
        },
        (request) =>
          Effect.succeed({
            answers: Object.fromEntries(
              request.questions.map((entry) => [entry.id, "custom rewrite"]),
            ),
          }),
      );

      expect(server.tools.map(({ tool }) => tool.name)).toEqual(["request_user_input"]);
      expect(server.tools[0]?.tool.annotations?.openWorldHint).toBe(false);

      const tooMany = yield* server
        .callTool({
          name: "request_user_input",
          arguments: {
            questions: [interactionQuestion, interactionQuestion, interactionQuestion, interactionQuestion],
          },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, matchingInvocation),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.flip,
        );
      expect(tooMany._tag).toBe("InvalidParams");

      const mismatch = yield* server
        .callTool({
          name: "request_user_input",
          arguments: { questions: [interactionQuestion] },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(mismatch.isError).toBe(true);
      expect(mismatch.content).toEqual([
        { type: "text", text: McpInteractionBroker.MCP_INTERACTION_NO_ACTIVE_TURN },
      ]);

      const answered = yield* server
        .callTool({
          name: "request_user_input",
          arguments: { questions: [interactionQuestion] },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, matchingInvocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(answered.isError).toBe(false);
      expect(answered.structuredContent).toEqual({
        answers: { implementation: "custom rewrite" },
      });
    }),
  ).pipe(Effect.provide(InteractionTestLayer)),
);

it.effect("keeps an interaction MCP call pending until answered or cancelled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* McpInteractionBroker.McpInteractionBroker;
      const matchingInvocation = {
        ...invocation,
        providerInstanceId: ProviderInstanceId.make("antigravity"),
        providerSessionId: "antigravity-session",
        activeTurnId: "turn-pending",
      };
      const deferred = yield* Deferred.make<
        McpInteractionBroker.McpInteractionToolOutput,
        string
      >();
      const unregister = yield* broker.register(
        {
          threadId: matchingInvocation.threadId,
          providerSessionId: matchingInvocation.providerSessionId,
          providerInstanceId: matchingInvocation.providerInstanceId,
          turnId: "turn-pending",
        },
        () => Deferred.await(deferred),
      );

      const pendingFiber = yield* server
        .callTool({
          name: "request_user_input",
          arguments: { questions: [interactionQuestion] },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, matchingInvocation),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.forkScoped,
        );
      yield* Effect.yieldNow;
      expect(pendingFiber.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(deferred, { answers: { implementation: "Option A" } });
      const answered = yield* Fiber.join(pendingFiber);
      expect(answered.isError).toBe(false);
      expect(answered.structuredContent).toEqual({
        answers: { implementation: "Option A" },
      });
      yield* unregister;

      const blocked = yield* Deferred.make<
        McpInteractionBroker.McpInteractionToolOutput,
        string
      >();
      const started = yield* Deferred.make<void>();
      const unregisterPending = yield* broker.register(
        {
          threadId: matchingInvocation.threadId,
          providerSessionId: matchingInvocation.providerSessionId,
          providerInstanceId: matchingInvocation.providerInstanceId,
          turnId: "turn-pending",
        },
        () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            return yield* Deferred.await(blocked);
          }),
      );
      const cancelledFiber = yield* server
        .callTool({
          name: "request_user_input",
          arguments: { questions: [interactionQuestion] },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, matchingInvocation),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.forkScoped,
        );
      yield* Deferred.await(started);
      expect(cancelledFiber.pollUnsafe()).toBeUndefined();
      yield* unregisterPending;
      const cancelled = yield* Fiber.join(cancelledFiber);
      expect(cancelled.isError).toBe(true);
      expect(cancelled.content).toEqual([
        { type: "text", text: McpInteractionBroker.MCP_INTERACTION_CANCELLED },
      ]);
    }),
  ).pipe(Effect.provide(InteractionTestLayer)),
);
