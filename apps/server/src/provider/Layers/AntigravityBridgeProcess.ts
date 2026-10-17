/**
 * AntigravityBridgeProcess — Supervisor and stdio JSON-RPC transport for the Python bridge.
 *
 * @module AntigravityBridgeProcess
 */

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ProviderAdapterProcessError, ProviderAdapterRequestError } from "../Errors.ts";
import { ProviderDriverKind } from "@t3tools/contracts";
import type { BridgeNotification, BridgeHelloPayload, BridgeProbeResult } from "../antigravity/bridgeProtocol.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");

export interface AntigravityBridgeProcess {
  readonly sendRequest: <TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ) => Effect.Effect<TResult, ProviderAdapterRequestError>;
  readonly streamNotifications: Stream.Stream<BridgeNotification>;
  readonly getHello: Effect.Effect<BridgeHelloPayload | undefined>;
  readonly probe: () => Effect.Effect<BridgeProbeResult, ProviderAdapterRequestError>;
  readonly close: Effect.Effect<void>;
}

export interface AntigravityBridgeProcessOptions {
  readonly pythonPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

export function resolveDefaultPythonCommand(): string {
  return process.platform === "win32" ? "python" : "python3";
}

export function resolveBridgeScriptPath(moduleUrl = import.meta.url): string {
  const currentDir = NodePath.dirname(fileURLToPath(moduleUrl));
  return NodePath.basename(currentDir) === "dist"
    ? NodePath.join(currentDir, "provider", "antigravity", "bridge.py")
    : NodePath.resolve(currentDir, "..", "antigravity", "bridge.py");
}

export const makeAntigravityBridgeProcess = (
  options: AntigravityBridgeProcessOptions = {},
): Effect.Effect<AntigravityBridgeProcess, ProviderAdapterProcessError, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const pythonCmd = options.pythonPath?.trim() || resolveDefaultPythonCommand();
    const bridgeScript = resolveBridgeScriptPath();

    const notificationsPubSub = yield* PubSub.unbounded<BridgeNotification>();
    const pendingRequests = yield* Ref.make<Map<number | string, Deferred.Deferred<unknown, ProviderAdapterRequestError>>>(
      new Map(),
    );
    const terminalError = yield* Ref.make<ProviderAdapterRequestError | undefined>(undefined);
    const helloRef = yield* Ref.make<BridgeHelloPayload | undefined>(undefined);
    let reqCounter = 0;

    const child = yield* Effect.try({
      try: () =>
        NodeChildProcess.spawn(pythonCmd, ["-I", "-u", bridgeScript], {
          cwd: options.cwd || process.cwd(),
          env: {
            ...process.env,
            ...options.environment,
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        }),
      catch: (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: "bridge",
          detail: `Failed to spawn Antigravity bridge via '${pythonCmd}': ${String(cause)}`,
          cause,
        }),
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 32768) {
        stderrBuffer = stderrBuffer.slice(-16384);
      }
    });

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.method) {
          // Notification
          if (parsed.method === "bridge.hello" && parsed.params) {
            Effect.runFork(Ref.set(helloRef, parsed.params as BridgeHelloPayload));
          }
          Effect.runFork(PubSub.publish(notificationsPubSub, parsed as BridgeNotification));
        } else if (parsed.id !== undefined) {
          // Request response
          const id = parsed.id;
          Effect.runFork(
            Effect.gen(function* () {
              const map = yield* Ref.get(pendingRequests);
              const def = map.get(id);
              if (def) {
                map.delete(id);
                if (parsed.error) {
                  yield* Deferred.fail(
                    def,
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: String(id),
                      detail: parsed.error.message || JSON.stringify(parsed.error),
                    }),
                  );
                } else {
                  yield* Deferred.succeed(def, parsed.result);
                }
              }
            }),
          );
        }
      } catch (err) {
        // Ignored invalid lines
      }
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        handleLine(line);
      }
    });

    const failBridge = (error: ProviderAdapterRequestError) =>
      Effect.gen(function* () {
        yield* Ref.set(terminalError, error);
        const map = yield* Ref.get(pendingRequests);
        for (const def of map.values()) {
          yield* Deferred.fail(def, error);
        }
        map.clear();
      });

    child.on("exit", (code, signal) => {
      Effect.runFork(
        failBridge(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "process.exit",
            detail: `Antigravity bridge exited with code ${code}, signal ${signal}. Stderr: ${stderrBuffer.trim() || "<empty>"}`,
          }),
        ),
      );
    });

    child.on("error", (cause) => {
      Effect.runFork(
        failBridge(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "process.error",
            detail: `Antigravity bridge process error: ${String(cause)}. Stderr: ${stderrBuffer.trim() || "<empty>"}`,
          }),
        ),
      );
    });

    const sendRequest = <TResult = unknown>(
      method: string,
      params: Record<string, unknown> = {},
    ): Effect.Effect<TResult, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        const stopped = yield* Ref.get(terminalError);
        if (stopped !== undefined) {
          return yield* Effect.fail(stopped);
        }

        const id = ++reqCounter;
        const deferred = yield* Deferred.make<unknown, ProviderAdapterRequestError>();
        yield* Ref.update(pendingRequests, (map) => {
          map.set(id, deferred);
          return map;
        });

        const stoppedAfterRegistration = yield* Ref.get(terminalError);
        if (stoppedAfterRegistration !== undefined) {
          yield* Ref.update(pendingRequests, (map) => {
            map.delete(id);
            return map;
          });
          return yield* Effect.fail(stoppedAfterRegistration);
        }

        if (child.stdin === null || child.stdin.destroyed || !child.stdin.writable) {
          yield* Ref.update(pendingRequests, (map) => {
            map.delete(id);
            return map;
          });
          return yield* Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method,
              detail: `Antigravity bridge is not running. Stderr: ${stderrBuffer.trim() || "<empty>"}`,
            }),
          );
        }

        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }) + "\n";

        yield* Effect.try({
          try: () => {
            child.stdin.write(payload);
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method,
              detail: `Failed to write to Antigravity bridge stdin: ${String(cause)}`,
              cause,
            }),
        });

        const result = yield* Deferred.await(deferred);
        return result as TResult;
      });

    const probe = (): Effect.Effect<BridgeProbeResult, ProviderAdapterRequestError> =>
      sendRequest<BridgeProbeResult>("probe", {});

    const close = Effect.gen(function* () {
      try {
        if (!child.killed) {
          child.stdin?.end();
          child.kill("SIGTERM");
        }
      } catch {
        // Ignored
      }
    });

    yield* Scope.addFinalizer(scope, close);

    return {
      sendRequest,
      streamNotifications: Stream.fromPubSub(notificationsPubSub),
      getHello: Ref.get(helloRef),
      probe,
      close,
    };
  });
