import { assert, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, type DesktopSnapShotState } from "@t3tools/contracts";

import {
  createRecordingRequestTracker,
  snapShotStatus,
  snapShotShortcutStatus,
  snapShotSetupSummary,
  snapShotSetupButtonLabel,
  snapShotSetupComplete,
} from "./SnapShotSettings.logic";

it("ignores a stale request after a newer request starts", () => {
  const requests = createRecordingRequestTracker();
  const firstRequest = requests.tryBegin();
  assert(firstRequest);

  requests.clear();
  const secondRequest = requests.tryBegin();
  assert(secondRequest);

  expect(requests.owns(firstRequest)).toBe(false);
  expect(requests.owns(secondRequest)).toBe(true);
  expect(requests.tryBegin()).toBeNull();
});

const direct: DesktopSnapShotState = {
  mode: "direct",
  shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
  shortcutRegistered: true,
  shortcutMessage: null,
  message: null,
};

it("waits for opt-in before presenting setup requirements", () => {
  const state = { ...direct, message: "Capture needs attention" };

  expect(DEFAULT_CLIENT_SETTINGS.snapShotEnabled).toBe(false);
  expect(snapShotStatus(state, false)).toBe("Turn this on to set up snapshots.");
  expect(snapShotStatus(state, true)).toBe("Capture needs attention");
  expect(snapShotStatus(null, true)).toBe("Checking snapshots…");
  expect(snapShotStatus({ ...direct, mode: "unavailable", message: "Not here" }, true)).toBe(
    "Not here",
  );
});

it("distinguishes saved shortcuts from observed delivery without making users repeat setup", () => {
  expect(snapShotSetupSummary(direct, true)).toBe("Shortcut saved");
  expect(snapShotSetupButtonLabel(direct)).toBe("Manage capture");
  expect(snapShotSetupSummary({ ...direct, shortcutVerified: true }, true)).toBe(
    "Ready to capture",
  );
  expect(snapShotSetupSummary({ ...direct, shortcutVerified: true }, false)).toContain(
    "Enable capture",
  );
  expect(snapShotSetupSummary({ ...direct, shortcutRegistered: false }, true)).toBe(
    "Finish shortcut setup",
  );
});

it("reports a saved shortcut, or why none is registered", () => {
  expect(snapShotShortcutStatus(null)).toBeNull();
  expect(snapShotShortcutStatus(direct)).toBe("Shortcut saved.");
  expect(
    snapShotShortcutStatus({
      ...direct,
      shortcutRegistered: false,
      shortcutMessage: "This shortcut is already used by the system or another app.",
    }),
  ).toBe("This shortcut is already used by the system or another app.");
});

it("hides macOS setup only while permissions and the shortcut are all in place", () => {
  const ready: DesktopSnapShotState = {
    ...direct,
    macPermissions: { screenRecording: true, accessibility: true },
  };
  expect(snapShotSetupComplete(ready, true)).toBe(true);
  expect(snapShotSetupComplete({ ...ready, macPermissions: undefined }, true)).toBe(false);
  expect(snapShotSetupComplete({ ...ready, shortcutRegistered: false }, true)).toBe(false);
  const revoked = {
    ...ready,
    macPermissions: { screenRecording: true, accessibility: false },
    message: "Allow Accessibility in System Settings, then restart Harp.",
  };
  expect(snapShotSetupComplete(revoked, true)).toBe(false);
  expect(snapShotStatus(revoked, true)).toBe("Capture needs attention");
  expect(snapShotSetupButtonLabel(revoked)).toBe("Continue setup");
  expect(snapShotSetupComplete({ ...revoked, message: null }, false)).toBe(true);
  expect(
    snapShotSetupComplete(
      { ...ready, windows: true, macPermissions: undefined, shortcutRegistered: false },
      true,
    ),
  ).toBe(true);
});
