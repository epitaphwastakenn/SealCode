export interface ThrottleClock {
  readonly now: () => number;
  readonly setTimer: (run: () => void, delayMs: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

const browserClock: ThrottleClock = {
  now: () => performance.now(),
  setTimer: (run, delayMs) => window.setTimeout(run, delayMs),
  clearTimer: (timer) => window.clearTimeout(timer as number),
};

/**
 * Passes at most one value per interval to `commit`: the first right away, the latest of the
 * rest when the interval is up. `flush` commits what is waiting now.
 */
export class ThrottledValue<T> {
  private waiting: { readonly value: T } | null = null;
  private timer: unknown = null;
  private lastCommitAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly commit: (value: T) => void,
    private readonly intervalMs: number,
    private readonly clock: ThrottleClock = browserClock,
  ) {}

  push(value: T): void {
    const wait = this.lastCommitAt + this.intervalMs - this.clock.now();
    if (this.timer === null && wait <= 0) {
      this.run(value);
      return;
    }
    this.waiting = { value };
    if (this.timer === null) {
      this.timer = this.clock.setTimer(() => {
        this.timer = null;
        this.flush();
      }, wait);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      this.clock.clearTimer(this.timer);
      this.timer = null;
    }
    const waiting = this.waiting;
    if (waiting !== null) this.run(waiting.value);
  }

  private run(value: T): void {
    this.waiting = null;
    this.lastCommitAt = this.clock.now();
    this.commit(value);
  }
}
