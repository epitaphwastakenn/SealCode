import { CommandId, ThreadId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as ComputerUseChannel from "./ComputerUseChannel.ts";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/**
 * Ties the desktop's computer-use mode to the thread's turn: the overlay goes
 * away when the run ends, and the overlay's Stop interrupts the run.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const channel = yield* ComputerUseChannel.ComputerUseChannel;
    if (!channel.available) return;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const crypto = yield* Crypto.Crypto;

    const endTurn = (event: OrchestrationV2DomainEvent) => {
      if (event.type !== "run.updated" || !TERMINAL_RUN_STATUSES.has(event.payload.status)) {
        return Effect.void;
      }
      return settings.getSettings.pipe(
        Effect.map((current) => current.computerUse.restoreHiddenApps),
        Effect.orElseSucceed(() => true),
        Effect.flatMap((restoreHiddenApps) =>
          channel.end({ threadId: event.threadId, restoreHiddenApps }),
        ),
      );
    };

    const stopTurn = (rawThreadId: string) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(rawThreadId);
        const shell = yield* threads.getThreadShell(threadId);
        if (shell === null) return;
        const id = yield* crypto.randomUUIDv4();
        yield* threads.interruptThread({
          projectId: shell.projectId,
          commandId: CommandId.make(`computer-use-stop:${id}`),
          threadId,
          reason: "The user stopped computer use.",
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("stopping a computer-use turn failed", {
            threadId: rawThreadId,
            cause,
          }),
        ),
      );

    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, endTurn).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("computer use turn stream failed", { cause }),
        ),
      ),
    );
    yield* forkParked(Stream.runForEach(channel.stops, stopTurn));
  }),
);
