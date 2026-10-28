import { describe, expect, it } from "vite-plus/test";

import { ThrottledValue, type ThrottleClock } from "./throttledValue";

function setup(intervalMs = 100) {
  let now = 1_000;
  let nextId = 1;
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>();
  const clock: ThrottleClock = {
    now: () => now,
    setTimer: (run, delayMs) => {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, run });
      return id;
    },
    clearTimer: (timer) => {
      timers.delete(timer as number);
    },
  };
  const committed: number[] = [];
  const throttle = new ThrottledValue<number>((value) => committed.push(value), intervalMs, clock);
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.run();
    }
  };
  return { throttle, committed, advance, pendingTimers: () => timers.size };
}

describe("ThrottledValue", () => {
  it("commits the first value at once and the latest of a burst when the interval is up", () => {
    const { throttle, committed, advance } = setup();

    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    expect(committed).toEqual([1]);

    advance(99);
    expect(committed).toEqual([1]);
    advance(1);
    expect(committed).toEqual([1, 3]);
  });

  it("commits at once again after a quiet interval", () => {
    const { throttle, committed, advance } = setup();

    throttle.push(1);
    advance(150);
    throttle.push(2);

    expect(committed).toEqual([1, 2]);
  });

  it("flush commits the waiting value and cancels its timer", () => {
    const { throttle, committed, advance, pendingTimers } = setup();

    throttle.push(1);
    throttle.push(2);
    throttle.flush();
    advance(500);

    expect(committed).toEqual([1, 2]);
    expect(pendingTimers()).toBe(0);
  });

  it("flush with nothing waiting commits nothing", () => {
    const { throttle, committed } = setup();

    throttle.push(1);
    throttle.flush();
    throttle.flush();

    expect(committed).toEqual([1]);
  });
});
