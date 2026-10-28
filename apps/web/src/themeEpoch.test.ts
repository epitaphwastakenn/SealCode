import { describe, expect, it, vi } from "vite-plus/test";

import { bumpThemeEpoch, subscribeThemeEpoch } from "./themeEpoch";

describe("theme epoch", () => {
  it("tells every subscriber once per bump, until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeThemeEpoch(first);
    const unsubscribeSecond = subscribeThemeEpoch(second);

    bumpThemeEpoch();
    unsubscribeFirst();
    bumpThemeEpoch();
    unsubscribeSecond();
    bumpThemeEpoch();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("lets a subscriber leave while it is being notified", () => {
    const later = vi.fn();
    const unsubscribeSelf = subscribeThemeEpoch(() => unsubscribeSelf());
    const unsubscribeLater = subscribeThemeEpoch(later);

    bumpThemeEpoch();
    unsubscribeLater();

    expect(later).toHaveBeenCalledTimes(1);
  });
});
