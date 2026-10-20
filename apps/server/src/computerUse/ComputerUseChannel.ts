// @effect-diagnostics nodeBuiltinImport:off - Reads the desktop's computer-use pipe.
/**
 * Computer use runs in the desktop app that launched this server, never in the
 * server itself: the server may be remote, and only the desktop process can
 * see and drive the screen in front of the user. The desktop hands its backend
 * a pipe pair at spawn, so the channel exists exactly when this server and that
 * desktop share a computer.
 */
import * as NodeStream from "@effect/platform-node/NodeStream";
import {
  ComputerUseCommand,
  ComputerUseEvent,
  type ComputerUseAction,
  type ComputerUseActionResult,
  type ComputerUseCommand as ComputerUseCommandType,
  type ComputerUseEvent as ComputerUseEventType,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Ndjson from "effect/encoding/Ndjson";
import * as NodeNet from "node:net";

import * as ServerConfig from "../config.ts";
import { writeAllToFileDescriptor } from "../resourceTelemetry/DesktopTelemetryReceiver.ts";

export class ComputerUseError extends Schema.TaggedError<ComputerUseError>()("ComputerUseError", {
  message: Schema.String,
}) {}

export const COMPUTER_USE_UNAVAILABLE_MESSAGE =
  "Computer use requires the SealCode desktop app on this computer.";
const COMPUTER_USE_UNSUPPORTED_MESSAGE = "Computer use is only available on Windows for now.";

const DEFAULT_ACTION_TIMEOUT_MS = 60_000;
/** The person at the computer answers the access dialog, which takes as long as it takes. */
const ACCESS_REQUEST_TIMEOUT_MS = 10 * 60_000;

export const computerUseActionTimeoutMs = (action: ComputerUseAction) =>
  action.kind === "request_access" ? ACCESS_REQUEST_TIMEOUT_MS : DEFAULT_ACTION_TIMEOUT_MS;

export interface ComputerUseInvokeInput {
  readonly threadId: string;
  readonly agentName?: string;
  readonly action: ComputerUseAction;
}

export class ComputerUseChannel extends Context.Service<
  ComputerUseChannel,
  {
    readonly available: boolean;
    readonly invoke: (
      input: ComputerUseInvokeInput,
    ) => Effect.Effect<ComputerUseActionResult, ComputerUseError>;
    /**
     * Leaves the overlay and restores the desktop once the thread's turn is
     * over; a no-op for threads that never drove the computer.
     */
    readonly end: (input: {
      readonly threadId: string;
      readonly restoreHiddenApps: boolean;
    }) => Effect.Effect<void>;
    /** Threads whose user pressed Stop or Esc in the desktop overlay. */
    readonly stops: Stream.Stream<string>;
  }
>()("t3/computerUse/ComputerUseChannel") {}

interface PendingAction {
  readonly threadId: string;
  readonly deferred: Deferred.Deferred<ComputerUseActionResult, ComputerUseError>;
}

/** Request/response bookkeeping over a one-way command sink; the fd transport feeds `handleEvent`. */
export const makeComputerUseBroker = Effect.fn("ComputerUseChannel.makeBroker")(function* (
  send: (command: ComputerUseCommandType) => Effect.Effect<void>,
) {
  const pending = new Map<string, PendingAction>();
  const activeThreads = new Set<string>();
  const stops = yield* PubSub.unbounded<string>();
  let sequence = 0;

  const invoke = (input: ComputerUseInvokeInput) =>
    Effect.suspend(() => {
      sequence += 1;
      // The desktop broadcasts results to every backend it runs, so ids carry this process.
      const requestId = `computer-use-${process.pid}-${sequence}`;
      const timeoutMs = computerUseActionTimeoutMs(input.action);
      return Effect.gen(function* () {
        const deferred = yield* Deferred.make<ComputerUseActionResult, ComputerUseError>();
        pending.set(requestId, { threadId: input.threadId, deferred });
        activeThreads.add(input.threadId);
        yield* send({
          type: "invoke",
          requestId,
          threadId: input.threadId,
          ...(input.agentName === undefined ? {} : { agentName: input.agentName }),
          action: input.action,
        });
        const settled = yield* Deferred.await(deferred).pipe(Effect.timeoutOption(timeoutMs));
        if (Option.isNone(settled)) {
          return yield* new ComputerUseError({
            message: `The desktop app did not finish ${input.action.kind} within ${Math.round(timeoutMs / 1000)} seconds.`,
          });
        }
        return settled.value;
      }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(requestId))));
    });

  const handleEvent = (event: ComputerUseEventType) =>
    Effect.gen(function* () {
      if (event.type === "stop") {
        for (const entry of pending.values()) {
          if (entry.threadId !== event.threadId) continue;
          yield* Deferred.fail(
            entry.deferred,
            new ComputerUseError({ message: "The user stopped computer use." }),
          );
        }
        yield* PubSub.publish(stops, event.threadId);
        return;
      }
      const entry = pending.get(event.requestId);
      if (entry === undefined) return;
      yield* event.ok
        ? Deferred.succeed(entry.deferred, event.result)
        : Deferred.fail(entry.deferred, new ComputerUseError({ message: event.message }));
    });

  return {
    invoke,
    handleEvent,
    end: (input: { readonly threadId: string; readonly restoreHiddenApps: boolean }) =>
      Effect.suspend(() =>
        activeThreads.delete(input.threadId) ? send({ type: "end", ...input }) : Effect.void,
      ),
    stops: Stream.fromPubSub(stops),
  };
});

const unavailable = (message: string) =>
  ComputerUseChannel.of({
    available: false,
    invoke: () => Effect.fail(new ComputerUseError({ message })),
    end: () => Effect.void,
    stops: Stream.empty,
  });

const decodeEvent = Schema.decodeUnknownEffect(ComputerUseEvent);
const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(ComputerUseCommand));

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const inputFd = config.desktopComputerUseFd;
  const controlFd = config.desktopComputerUseControlFd;
  if (inputFd === undefined || controlFd === undefined) {
    return unavailable(COMPUTER_USE_UNAVAILABLE_MESSAGE);
  }
  if ((yield* HostProcess.Platform) !== "win32") {
    return unavailable(COMPUTER_USE_UNSUPPORTED_MESSAGE);
  }

  const writeLock = yield* Semaphore.make(1);
  const broker = yield* makeComputerUseBroker((command) =>
    writeLock.withPermits(1)(
      encodeCommand(command).pipe(
        Effect.flatMap((line) => writeAllToFileDescriptor(controlFd, Buffer.from(`${line}\n`))),
        Effect.catchCause((cause) => Effect.logWarning("computer use command failed", { cause })),
      ),
    ),
  );

  // Same reasoning as DesktopBrowserChannel: a socket read can be cancelled
  // while the desktop holds its end open, a filesystem read cannot.
  const readable = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeNet.Socket({ fd: inputFd, readable: true, writable: false })),
    (stream) => Effect.sync(() => stream.destroy()),
  );
  yield* NodeStream.fromReadable<Uint8Array, Error>({
    evaluate: () => readable,
    closeOnDone: true,
    onError: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
    Stream.mapEffect((value) => decodeEvent(value).pipe(Effect.option)),
    Stream.runForEach((decoded) =>
      Option.isSome(decoded) ? broker.handleEvent(decoded.value) : Effect.void,
    ),
    Effect.catchCause((cause) => Effect.logWarning("computer use channel stopped", { cause })),
    Effect.forkScoped,
  );

  return ComputerUseChannel.of({
    available: true,
    invoke: broker.invoke,
    end: broker.end,
    stops: broker.stops,
  });
});

export const layer = Layer.effect(ComputerUseChannel, make);

export const layerTest = (service: ComputerUseChannel["Service"]) =>
  Layer.succeed(ComputerUseChannel, service);
