import { DEFAULT_CLIENT_SETTINGS, type DesktopSnapShotState } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  captureSetupAccessReady,
  captureSetupInitialStep,
  captureSetupMacPermissionsReady,
  captureSetupShortcutReady,
  captureSetupShouldDisableOnClose,
} from "./SnapShotSetupDialog.logic";

const direct: DesktopSnapShotState = {
  mode: "direct",
  shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
  shortcutRegistered: true,
  shortcutMessage: null,
  shortcutVerified: false,
  message: null,
};

it("resumes on the shortcut step once a shortcut is registered", () => {
  expect(captureSetupInitialStep(direct)).toBe("shortcut");
  expect(captureSetupInitialStep(direct, "access")).toBe("access");
});

it("does not skip native permission setup when capture has not been enabled", () => {
  expect(captureSetupInitialStep({ ...direct, shortcutRegistered: false })).toBe("access");
});

it("keeps setup on the access step while capture needs attention, even with a verified shortcut", () => {
  const state = { ...direct, shortcutVerified: true, message: "Desktop disconnected" };
  expect(captureSetupAccessReady(state)).toBe(false);
  expect(captureSetupInitialStep(state)).toBe("access");
  expect(captureSetupInitialStep(state, "shortcut")).toBe("access");
  expect(captureSetupShortcutReady(state, false)).toBe(false);
  expect(captureSetupAccessReady({ ...direct, mode: "unavailable" })).toBe(false);
});

it("requires saving a changed chord before finishing setup", () => {
  expect(captureSetupShortcutReady(direct, true)).toBe(false);
  expect(captureSetupShortcutReady(direct, false)).toBe(true);
  expect(captureSetupShortcutReady({ ...direct, shortcutRegistered: false }, false)).toBe(false);
});

it.each([
  [false, false, true],
  [true, false, false],
] as const)(
  "closing setup (previously enabled=%s, completed=%s) disables only an unfinished first opt-in",
  (wasEnabled, completed, disable) => {
    expect(captureSetupShouldDisableOnClose(wasEnabled, completed)).toBe(disable);
  },
);

it("gates Continue on macOS permissions, requiring accessibility only when app text is on", () => {
  const mac: DesktopSnapShotState = {
    ...direct,
    macPermissions: { screenRecording: true, accessibility: false },
  };
  expect(captureSetupMacPermissionsReady(mac, true)).toBe(false);
  expect(captureSetupMacPermissionsReady(mac, false)).toBe(true);
  expect(
    captureSetupMacPermissionsReady(
      { ...mac, macPermissions: { screenRecording: false, accessibility: true } },
      false,
    ),
  ).toBe(false);
  expect(captureSetupMacPermissionsReady({ ...mac, macPermissions: undefined }, true)).toBe(true);
});
