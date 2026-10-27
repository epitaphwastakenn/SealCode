import { DEFAULT_CLIENT_SETTINGS, type SnapShotKeyChord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { snapShotShortcutKeyLabels } from "./snapShotShortcut";

describe("window capture shortcut labels", () => {
  const chord = (overrides: Partial<SnapShotKeyChord>): SnapShotKeyChord => ({
    key: "2",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: false,
    ...overrides,
  });

  it.each([
    [chord({ ctrlKey: true, shiftKey: true }), "Win32", ["Ctrl", "⇧", "2"]],
    [chord({ metaKey: true, key: "f12" }), "Win32", ["⊞", "F12"]],
    [chord({ modKey: true, altKey: true, key: "enter" }), "MacIntel", ["⌥", "⌘", "Enter"]],
  ])("formats %j on %s using the shared keycap labels", (shortcut, platform, expected) => {
    expect(snapShotShortcutKeyLabels(shortcut, platform)).toEqual(expected);
  });

  it("labels the default modifier pair by its key", () => {
    expect(snapShotShortcutKeyLabels(DEFAULT_CLIENT_SETTINGS.snapShotShortcut, "Win32")).toEqual([
      "⇧",
      "⇧",
    ]);
  });
});
