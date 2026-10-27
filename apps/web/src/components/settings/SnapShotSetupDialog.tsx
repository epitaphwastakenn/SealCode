import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import {
  isModifierPairShortcut,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { MacAccessibilityIcon, MacScreenRecordingIcon } from "../Icons";
import { Button } from "../ui/button";
import { Dialog, DialogDescription } from "../ui/dialog";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";
import {
  captureSetupAccessReady,
  captureSetupInitialStep,
  captureSetupShortcutReady,
  type CaptureSetupStep,
} from "./SnapShotSetupDialog.logic";

const SETUP_STEPS = [
  { id: "access", label: "Access" },
  { id: "shortcut", label: "Shortcut" },
] as const;

export function SnapShotSetupDialog({
  state,
  initialStep,
  wasEnabled,
  includeAccessibility,
  busy,
  error,
  shortcutInput,
  shortcutStatus,
  shortcutChanged,
  canSaveShortcut,
  onSaveShortcut,
  onEnable,
  onAction,
  onRefresh,
  onClose,
  onLeaveStep,
}: {
  state: DesktopSnapShotState;
  initialStep: CaptureSetupStep;
  wasEnabled: boolean;
  includeAccessibility: boolean;
  busy: boolean;
  error: string | null;
  shortcutInput: ReactNode;
  shortcutStatus: string | null | undefined;
  shortcutChanged: boolean;
  canSaveShortcut: boolean;
  onSaveShortcut: () => Promise<boolean>;
  onEnable: () => Promise<boolean>;
  onAction: (action: DesktopSnapShotSetupAction) => Promise<void>;
  onRefresh: () => Promise<DesktopSnapShotState | undefined>;
  onClose: (completed: boolean) => Promise<void>;
  onLeaveStep: () => void;
}) {
  const [step, setStep] = useState(() => captureSetupInitialStep(state, initialStep));
  const accessReady = captureSetupAccessReady(state);
  const permissionStatus = usePermissionStatus(
    async () => {
      const refreshed = await onRefresh();
      if (!refreshed?.macPermissions) throw new Error("Permission status unavailable");
      return refreshed.macPermissions;
    },
    state.macPermissions ?? { screenRecording: false, accessibility: false },
    Boolean(state.macPermissions) && step === "access" && !busy,
  );
  const macPermissions = state.macPermissions ? permissionStatus.status : undefined;
  const macPermissionsReady =
    !macPermissions ||
    permissionStatus.isReady(
      includeAccessibility ? ["screenRecording", "accessibility"] : ["screenRecording"],
    );
  const shortcutReady = captureSetupShortcutReady(state, shortcutChanged);
  const changeStep = (next: CaptureSetupStep) => {
    onLeaveStep();
    setStep(next);
  };
  const accessCopy =
    state.message && !macPermissions
      ? {
          title: "Let's try that again",
          description: "Couldn't check snapshots. Try again to continue.",
        }
      : {
          title: "Allow snapshots",
          description: macPermissions
            ? macPermissionsReady
              ? "Test a snapshot of the current window. If macOS asks to bypass its window picker, choose Allow. The test image is discarded."
              : "Allow each permission, then continue."
            : "Allow access when prompted to start capturing windows.",
        };
  const title = step === "access" ? accessCopy.title : "Choose your shortcut";
  const description =
    step === "access"
      ? accessCopy.description
      : "Use both Shift keys, or record a different shortcut.";
  const stepIndex = SETUP_STEPS.findIndex(({ id }) => id === step);
  const details = [
    ...new Set(
      [error, ...(step === "access" ? [state.message] : [])].filter((detail) => detail !== null),
    ),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void onClose(false);
      }}
    >
      <WizardPopup showCloseButton={!busy}>
        <WizardHeader title="Set up snapshots">
          <WizardSteps
            steps={SETUP_STEPS.map((item) => item.label)}
            currentStep={stepIndex}
            isStepDisabled={(index) => busy || index > stepIndex}
            onStepChange={(index) => {
              const next = SETUP_STEPS[index];
              if (next && next.id !== step) changeStep(next.id);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          <div className="space-y-4 text-sm">
            <div className="space-y-2" aria-live="polite">
              <h3 className="flex items-center gap-2 font-medium">{title}</h3>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {step === "access" ? (
              <>
                {macPermissions ? (
                  <PermissionChecklist
                    busy={busy}
                    permissions={[
                      {
                        id: "screenRecording",
                        icon: <MacScreenRecordingIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: "Screen Recording",
                        description: "Capture the window you're using.",
                        granted: macPermissions.screenRecording,
                        onAllow: () => void onAction("allow-screen-recording"),
                      },
                      {
                        id: "accessibility",
                        icon: <MacAccessibilityIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: "Accessibility",
                        description: includeAccessibility
                          ? "Include text and controls from the captured app."
                          : "Optional. Include text and controls from the captured app.",
                        granted: macPermissions.accessibility,
                        onAllow: () => void onAction("allow-accessibility"),
                      },
                    ]}
                  />
                ) : null}
                {permissionStatus.error && macPermissions ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {permissionStatus.error}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="space-y-3">
                {shortcutInput}
                {shortcutStatus ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {shortcutStatus}
                  </p>
                ) : null}
                {!shortcutChanged &&
                !state.shortcutRegistered &&
                !isModifierPairShortcut(state.shortcut) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onAction("retry-shortcut")}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            )}
            {step === "shortcut" && !accessReady ? (
              <p role="alert" className="text-destructive">
                Capture needs attention. Go back to check access.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                Couldn't finish this step. Try again or check Advanced for help.
              </p>
            ) : null}
            {details.length > 0 ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Advanced</summary>
                <div className="mt-3 space-y-3">
                  {details.map((detail) => (
                    <p key={detail} className="break-words">
                      {detail}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter>
          {step !== "access" ? (
            <Button variant="ghost" disabled={busy} onClick={() => changeStep("access")}>
              Back
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void onClose(false)}>
            {wasEnabled ? "Close" : "Finish later"}
          </Button>
          {step === "access" ? (
            <PermissionContinueButton
              ready={macPermissionsReady}
              busy={busy}
              onClick={async () => {
                if (await onEnable()) changeStep("shortcut");
              }}
            >
              {busy ? "Working…" : macPermissions ? "Test capture and continue" : "Allow capture"}
            </PermissionContinueButton>
          ) : (
            <Button
              disabled={
                busy || !accessReady || (shortcutChanged ? !canSaveShortcut : !shortcutReady)
              }
              onClick={async () => {
                if (!shortcutChanged || (await onSaveShortcut())) await onClose(true);
              }}
            >
              {busy ? "Saving…" : shortcutChanged ? "Save and finish" : "Done"}
            </Button>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
