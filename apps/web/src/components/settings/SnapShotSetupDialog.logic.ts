import type { DesktopSnapShotState } from "@t3tools/contracts";

export type CaptureSetupStep = "access" | "shortcut";

export function captureSetupAccessReady(state: DesktopSnapShotState): boolean {
  return state.mode !== "unavailable" && !state.message;
}

export function captureSetupMacPermissionsReady(
  state: DesktopSnapShotState,
  includeAccessibility: boolean,
): boolean {
  const permissions = state.macPermissions;
  if (!permissions) return true;
  return permissions.screenRecording && (!includeAccessibility || permissions.accessibility);
}

export function captureSetupShortcutReady(state: DesktopSnapShotState, unsaved: boolean): boolean {
  return !unsaved && captureSetupAccessReady(state) && state.shortcutRegistered;
}

export function captureSetupInitialStep(
  state: DesktopSnapShotState,
  requested: CaptureSetupStep | "resume" = "resume",
): CaptureSetupStep {
  if (!captureSetupAccessReady(state)) return "access";
  if (requested === "resume") {
    // A disabled capture has not checked permissions yet.
    return state.shortcutRegistered ? "shortcut" : "access";
  }
  return requested;
}

export function captureSetupShouldDisableOnClose(wasEnabled: boolean, completed: boolean): boolean {
  return !wasEnabled && !completed;
}
