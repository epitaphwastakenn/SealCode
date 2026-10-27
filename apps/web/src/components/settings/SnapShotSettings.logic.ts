import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@t3tools/contracts";
import {
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";

export function snapShotStatus(state: DesktopSnapShotState | null, enabled: boolean): string {
  if (!state) return "Checking snapshots…";
  if (state.mode === "unavailable") return state.message ?? "Not supported on this platform.";
  if (!enabled) return "Turn this on to set up snapshots.";
  return snapShotSetupSummary(state, enabled);
}

export function snapShotSetupSummary(state: DesktopSnapShotState, enabled: boolean): string {
  if (state.message) return "Capture needs attention";
  if (!enabled) return "Enable capture to continue";
  if (state.shortcutVerified) return "Ready to capture";
  if (state.shortcutRegistered) return "Shortcut saved";
  return "Finish shortcut setup";
}

export function snapShotShortcutStatus(state: DesktopSnapShotState | null): string | null {
  if (!state) return null;
  return state.shortcutRegistered ? "Shortcut saved." : state.shortcutMessage;
}

export function snapShotSetupButtonLabel(state: DesktopSnapShotState | null): string {
  return state && captureSetupAccessReady(state) ? "Manage capture" : "Continue setup";
}

export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotUnavailableMessage(hasBridge: boolean): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? "Update the desktop app to use snapshots."
    : "Only available in the desktop app.";
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
