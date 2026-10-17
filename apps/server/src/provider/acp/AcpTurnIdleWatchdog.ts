import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";

export interface AcpTurnIdleWatchdogParams {
  readonly idleTimeoutMs: number;
  readonly currentIdleTimeoutMs?: () => number;
  readonly checkIntervalMs: number;
  readonly scope: Scope.Closeable;
  readonly isTurnActive: () => boolean;
  readonly isAwaitingHuman: () => boolean;
  readonly lastActivityAt: () => number;
  readonly touchActivity: (nowMs: number) => void;
  readonly onIdleTimeout: (idleMs: number) => Effect.Effect<void>;
}

export type AcpTurnIdleTickDecision = "stop" | "touch" | "timeout" | "continue";

export function evaluateAcpTurnIdleTick(input: {
  readonly isTurnActive: boolean;
  readonly isAwaitingHuman: boolean;
  readonly idleMs: number;
  readonly idleTimeoutMs: number;
}): AcpTurnIdleTickDecision {
  if (!input.isTurnActive) {
    return "stop";
  }
  if (input.isAwaitingHuman) {
    return "touch";
  }
  return input.idleMs >= input.idleTimeoutMs ? "timeout" : "continue";
}

export function resolveAcpTurnIdleTimeoutMs(input: {
  readonly envVar: string;
  readonly defaultMs: number;
  readonly env?: NodeJS.ProcessEnv;
}): number {
  const raw = (input.env ?? process.env)[input.envVar]?.trim();
  if (!raw) {
    return input.defaultMs;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : input.defaultMs;
}

export const forkAcpTurnIdleWatchdog = (
  params: AcpTurnIdleWatchdogParams,
): Effect.Effect<Fiber.Fiber<void, never>> =>
  Effect.gen(function* () {
    const loop = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(Duration.millis(params.checkIntervalMs));
        const nowMs = yield* Clock.currentTimeMillis;
        const idleMs = nowMs - params.lastActivityAt();
        const idleTimeoutMs = params.currentIdleTimeoutMs?.() ?? params.idleTimeoutMs;
        const decision = evaluateAcpTurnIdleTick({
          isTurnActive: params.isTurnActive(),
          isAwaitingHuman: params.isAwaitingHuman(),
          idleMs,
          idleTimeoutMs,
        });
        if (decision === "stop") {
          return;
        }
        if (decision === "touch") {
          params.touchActivity(nowMs);
          continue;
        }
        if (decision === "timeout") {
          yield* params.onIdleTimeout(idleMs);
          return;
        }
      }
    });
    return yield* loop.pipe(Effect.forkIn(params.scope));
  });
