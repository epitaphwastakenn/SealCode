import { describe, expect, it } from "vite-plus/test";

import {
  evaluateAcpTurnIdleTick,
  resolveAcpTurnIdleTimeoutMs,
} from "./AcpTurnIdleWatchdog.ts";

describe("evaluateAcpTurnIdleTick", () => {
  it("stops once the watched turn is no longer active", () => {
    expect(
      evaluateAcpTurnIdleTick({
        isTurnActive: false,
        isAwaitingHuman: false,
        idleMs: 60_000,
        idleTimeoutMs: 1_000,
      }),
    ).toBe("stop");
  });

  it("refreshes the clock while the turn is waiting on a human", () => {
    expect(
      evaluateAcpTurnIdleTick({
        isTurnActive: true,
        isAwaitingHuman: true,
        idleMs: 60_000,
        idleTimeoutMs: 1_000,
      }),
    ).toBe("touch");
  });

  it("times out only after a silent stretch past the threshold", () => {
    expect(
      evaluateAcpTurnIdleTick({
        isTurnActive: true,
        isAwaitingHuman: false,
        idleMs: 999,
        idleTimeoutMs: 1_000,
      }),
    ).toBe("continue");
    expect(
      evaluateAcpTurnIdleTick({
        isTurnActive: true,
        isAwaitingHuman: false,
        idleMs: 1_000,
        idleTimeoutMs: 1_000,
      }),
    ).toBe("timeout");
  });
});

describe("resolveAcpTurnIdleTimeoutMs", () => {
  it("uses the default when the env var is missing, empty, or invalid", () => {
    expect(
      resolveAcpTurnIdleTimeoutMs({
        envVar: "MISSING_IDLE_TIMEOUT",
        defaultMs: 600_000,
        env: {},
      }),
    ).toBe(600_000);
    expect(
      resolveAcpTurnIdleTimeoutMs({
        envVar: "T3_CURSOR_TURN_IDLE_TIMEOUT_MS",
        defaultMs: 600_000,
        env: { T3_CURSOR_TURN_IDLE_TIMEOUT_MS: "  " },
      }),
    ).toBe(600_000);
    expect(
      resolveAcpTurnIdleTimeoutMs({
        envVar: "T3_CURSOR_TURN_IDLE_TIMEOUT_MS",
        defaultMs: 600_000,
        env: { T3_CURSOR_TURN_IDLE_TIMEOUT_MS: "nope" },
      }),
    ).toBe(600_000);
    expect(
      resolveAcpTurnIdleTimeoutMs({
        envVar: "T3_CURSOR_TURN_IDLE_TIMEOUT_MS",
        defaultMs: 600_000,
        env: { T3_CURSOR_TURN_IDLE_TIMEOUT_MS: "0" },
      }),
    ).toBe(600_000);
  });

  it("honors a positive numeric override", () => {
    expect(
      resolveAcpTurnIdleTimeoutMs({
        envVar: "T3_CURSOR_TURN_IDLE_TIMEOUT_MS",
        defaultMs: 600_000,
        env: { T3_CURSOR_TURN_IDLE_TIMEOUT_MS: "15000" },
      }),
    ).toBe(15_000);
  });
});
