// @effect-diagnostics nodeBuiltinImport:off - the bridge's own loopback listener is a Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as ServerSettings from "../serverSettings.ts";
import { PLUGIN_KEY_HEADER, StudioLimits, StudioRoutes } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";
import { handleMcpMessage } from "./studioMcp.ts";
import * as StudioPluginInstaller from "./StudioPluginInstaller.ts";
import * as StudioTools from "./StudioTools.ts";

const PLUGIN_KEY_SECRET = "studio-bridge-plugin-key";

const json = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.provideService(
      HttpIncomingMessage.MaxBodySize,
      ByteSize.bytes(StudioLimits.maxBodyBytes),
    ),
    Effect.map((value): Record<string, unknown> => (isRecord(value) ? value : {})),
    Effect.orElseSucceed((): Record<string, unknown> | undefined => undefined),
  );

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The listener for one run: plugin endpoints behind the install key, MCP behind its token. */
const routesFor = (input: { readonly pluginKey: string; readonly mcpToken: string }) => {
  /**
   * Browsers send Origin; Studio's HttpService does not. Refusing any Origin keeps web pages
   * from talking to the bridge even before the key is checked.
   */
  const plugin = <A>(
    route: `/${string}`,
    handle: (
      body: Record<string, unknown>,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, A>,
  ) =>
    HttpRouter.add(
      "POST",
      route,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.headers.origin !== undefined) return json(403, { error: "origin_refused" });
        const key = request.headers[PLUGIN_KEY_HEADER];
        if (typeof key !== "string" || !timingSafeEqual(key, input.pluginKey)) {
          return json(401, {
            success: false,
            error: "unknown_plugin_key",
            message:
              "This plugin's key does not match this SealCode. Restart Studio to load the plugin SealCode installed.",
          });
        }
        const body = yield* readBody(request);
        if (body === undefined) return json(400, { error: "invalid_json" });
        return yield* handle(body);
      }),
    );

  return Layer.mergeAll(
    plugin(StudioRoutes.hello, (body) =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        const toggles = isRecord(body.toggles) ? body.toggles : {};
        return yield* bridge
          .hello({
            protocol: number(body.protocol),
            build: text(body.build),
            pluginSessionId: text(body.pluginSessionId),
            instanceId: text(body.instanceId),
            role: text(body.role),
            placeId: number(body.placeId),
            gameId: number(body.gameId),
            placeName: text(body.placeName),
            dataModelName: text(body.dataModelName),
            isRunning: body.isRunning === true,
            studioVersion: text(body.studioVersion),
            pluginHash: text(body.pluginHash),
            capabilities: Array.isArray(body.capabilities)
              ? body.capabilities.filter((entry): entry is string => typeof entry === "string")
              : [],
            toggles: {
              paused: toggles.paused === true,
              readOnly: toggles.readOnly === true,
              allowLuau: toggles.allowLuau !== false,
            },
          })
          .pipe(
            Effect.map((accepted) => json(200, { success: true, ...accepted })),
            Effect.catchTags({
              StudioHelloRejected: (error) =>
                Effect.succeed(
                  json(error.status, {
                    success: false,
                    error: error.code,
                    message: error.message,
                    ...(error.fields === undefined ? {} : { fields: error.fields }),
                    ...(error.expectedProtocol === undefined
                      ? {}
                      : {
                          expectedProtocol: error.expectedProtocol,
                          actualProtocol: error.actualProtocol,
                        }),
                  }),
                ),
            }),
          );
      }),
    ),
    plugin(StudioRoutes.poll, (body) =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        return yield* bridge
          .poll({
            sessionToken: text(body.sessionToken),
            inFlight: Array.isArray(body.inFlight)
              ? body.inFlight.filter((id): id is string => typeof id === "string")
              : [],
            waitSeconds: number(body.waitSeconds),
            toggles: body.toggles,
          })
          .pipe(
            Effect.map((messages) => json(200, { messages })),
            Effect.catchTags({
              StudioSessionUnknown: (error) =>
                Effect.succeed(json(404, { error: "unknown_session", message: error.message })),
            }),
          );
      }),
    ),
    plugin(StudioRoutes.response, (body) =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        const requestId = text(body.requestId);
        if (requestId === "") return json(400, { error: "requestId is required" });
        const disposition = yield* bridge.respond({
          requestId,
          payload: "response" in body ? body.response : { error: text(body.error, "No result.") },
        });
        return json(200, { success: true, disposition });
      }),
    ),
    plugin(StudioRoutes.events, (body) =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        return yield* bridge
          .postEvents({
            sessionToken: text(body.sessionToken),
            events: Array.isArray(body.events) ? body.events : [],
          })
          .pipe(
            Effect.map((accepted) => json(200, { success: true, accepted })),
            Effect.catchTags({
              StudioSessionUnknown: () => Effect.succeed(json(404, { error: "unknown_session" })),
            }),
          );
      }),
    ),
    plugin(StudioRoutes.client, (body) =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        const sessionToken = text(body.sessionToken);
        const logicalId = text(body.logicalId);
        if (body.action === "unregister") {
          yield* bridge.unregisterClient({ sessionToken, logicalId });
          return json(200, { success: true });
        }
        return yield* bridge
          .registerClient({ sessionToken, logicalId, playerName: text(body.playerName) })
          .pipe(
            Effect.map((registered) => json(200, { success: true, ...registered })),
            Effect.catchTags({
              StudioSessionUnknown: () => Effect.succeed(json(404, { error: "unknown_session" })),
              StudioHelloRejected: (error) =>
                Effect.succeed(json(error.status, { success: false, error: error.code })),
            }),
          );
      }),
    ),
    plugin(StudioRoutes.bye, (body) =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        yield* bridge.bye(text(body.sessionToken));
        return json(200, { success: true });
      }),
    ),
    HttpRouter.add(
      "POST",
      StudioRoutes.mcp,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const authorization = request.headers.authorization ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        if (request.headers.origin !== undefined || !timingSafeEqual(token, input.mcpToken)) {
          return json(401, { error: "invalid_mcp_credential" });
        }
        const bridge = yield* StudioBridge.StudioBridge;
        const tools = yield* StudioTools.StudioTools;
        const message = yield* request.json.pipe(Effect.orElseSucceed(() => undefined));
        const reply = yield* handleMcpMessage(message, tools, bridge.markAgentLinked);
        return reply.kind === "accepted"
          ? HttpServerResponse.empty({ status: 202 })
          : json(200, reply.body);
      }),
    ),
    // No server-initiated stream: the tool list never changes while the bridge runs.
    HttpRouter.add(
      "GET",
      StudioRoutes.mcp,
      Effect.succeed(json(405, { error: "method_not_allowed" })),
    ),
  );
};

/**
 * Runs the bridge's listener and installs the plugin while the Roblox mode is `sealcode`, and
 * stops both when it is not. The registry itself lives in `StudioBridge` across restarts.
 */
const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const robloxConfig = yield* RobloxStudioConfig;
  const bridge = yield* StudioBridge.StudioBridge;
  const tools = yield* StudioTools.StudioTools;
  const installer = yield* StudioPluginInstaller.StudioPluginInstaller;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const studio = robloxConfig.environment.studioBridge;
  let running: Scope.Closeable | undefined;

  const start = Effect.gen(function* () {
    if (running !== undefined || studio === undefined) return;
    yield* bridge.setLifecycle({ state: "starting", port: studio.port, pluginUpdated: false });
    const pluginKey = Buffer.from(yield* secrets.getOrCreateRandom(PLUGIN_KEY_SECRET, 32)).toString(
      "base64url",
    );
    const scope = yield* Scope.make("sequential");
    const listening = yield* HttpRouter.serve(routesFor({ pluginKey, mcpToken: studio.mcpToken }), {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(
        NodeHttpServer.layer(NodeHttp.createServer, {
          host: "127.0.0.1",
          port: studio.port,
          disablePreemptiveShutdown: true,
        }),
      ),
      Layer.provide(Layer.succeed(StudioBridge.StudioBridge, bridge)),
      Layer.provide(Layer.succeed(StudioTools.StudioTools, tools)),
      Layer.buildWithScope(scope),
      Effect.exit,
    );
    if (Exit.isFailure(listening)) {
      yield* Scope.close(scope, Exit.void);
      yield* Effect.logWarning("Studio bridge could not listen", { port: studio.port });
      yield* bridge.setLifecycle({
        state: "failed",
        port: studio.port,
        error: `Port ${String(studio.port)} on 127.0.0.1 is in use or not available. Set SEALCODE_STUDIO_BRIDGE_PORT to another port.`,
        pluginUpdated: false,
      });
      return;
    }
    running = scope;
    const installed = yield* installer
      .install({ port: studio.port, key: pluginKey })
      .pipe(Effect.result);
    yield* bridge.setLifecycle(
      installed._tag === "Success"
        ? {
            state: "running",
            port: studio.port,
            pluginPath: installed.success.path,
            pluginHash: installed.success.pluginHash,
            pluginUpdated: installed.success.changed,
          }
        : {
            state: "running",
            port: studio.port,
            pluginUpdated: false,
            pluginProblem: installed.failure.message,
          },
    );
    if (installed._tag === "Failure") {
      yield* Effect.logWarning("Studio plugin install failed", { stage: installed.failure.stage });
    }
  });

  const stop = Effect.gen(function* () {
    if (running === undefined) return;
    const scope = running;
    running = undefined;
    yield* bridge.reset;
    yield* Scope.close(scope, Exit.void);
    yield* bridge.setLifecycle({ state: "stopped", pluginUpdated: false });
  });

  const lock = yield* Semaphore.make(1);
  // Another mode turns the bridge off for good, so its plugin goes too; a server that merely
  // exits keeps it, to reconnect on the next start.
  const disable = stop.pipe(Effect.andThen(installer.uninstall), Effect.asVoid);
  const apply = (current: { readonly robloxStudio: { readonly mode: string } }) =>
    lock.withPermits(1)(current.robloxStudio.mode === "sealcode" ? start : disable);

  yield* settings.getSettings.pipe(
    Effect.flatMap(apply),
    Effect.catchCause((cause) => Effect.logWarning("Studio bridge did not start", { cause })),
  );
  const changes = yield* settings.subscribeChanges;
  yield* changes.pipe(
    Stream.runForEach((next) => apply(next)),
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => stop);
});

export const layer = Layer.effectDiscard(make);
