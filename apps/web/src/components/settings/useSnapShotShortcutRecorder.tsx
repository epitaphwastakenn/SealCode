import type { SnapShotModifier, SnapShotShortcut } from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import { formatSnapShotShortcutLabel } from "../../lib/snapShotShortcut";
import { SnapShotShortcutKeys } from "../desktop/SnapShotShortcutKeys";
import { Button } from "../ui/button";
import { keybindingFromKeyboardEvent } from "./KeybindingsSettings.logic";
import { createRecordingRequestTracker } from "./SnapShotSettings.logic";

const MODIFIER_FROM_KEY: Readonly<Record<string, SnapShotModifier>> = {
  Shift: "shift",
  Meta: "meta",
  OS: "meta",
  Control: "control",
  Alt: "alt",
  AltGraph: "alt",
};
const MODIFIER_CODES: Readonly<Record<SnapShotModifier, readonly [string, string]>> = {
  shift: ["ShiftLeft", "ShiftRight"],
  meta: ["MetaLeft", "MetaRight"],
  control: ["ControlLeft", "ControlRight"],
  alt: ["AltLeft", "AltRight"],
};

export function useSnapShotShortcutRecorder({
  shortcut,
  disabled = false,
  onRecord,
  onStart,
  onError,
}: {
  shortcut: SnapShotShortcut;
  disabled?: boolean;
  onRecord: (shortcut: SnapShotShortcut) => void;
  onStart?: () => void;
  onError: (message: string) => void;
}) {
  const bridge = getDesktopSnapShotBridge();
  const [recording, setRecording] = useState(false);
  const [requests] = useState(createRecordingRequestTracker);
  const heldModifierCodes = useRef(new Set<string>());
  const stopRecording = () => {
    requests.clear();
    heldModifierCodes.current.clear();
    setRecording(false);
    void bridge?.setSnapShotShortcutSuppressed(false).catch(() => undefined);
  };
  const startRecording = async () => {
    if (!bridge || disabled) return;
    const request = requests.tryBegin();
    if (!request) return;
    heldModifierCodes.current.clear();
    onStart?.();
    try {
      await bridge.setSnapShotShortcutSuppressed(true);
      if (requests.owns(request)) setRecording(true);
    } catch (error) {
      if (!requests.owns(request)) return;
      requests.clear();
      onError(error instanceof Error ? error.message : "Could not start shortcut recording.");
    }
  };
  useEffect(
    () => () => {
      requests.clear();
      void bridge?.setSnapShotShortcutSuppressed(false).catch(() => undefined);
    },
    [bridge, requests],
  );
  const recordShortcut = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.key === "Tab" || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    const modifier = MODIFIER_FROM_KEY[event.key];
    if (modifier) {
      const held = heldModifierCodes.current;
      held.add(event.code);
      const [left, right] = MODIFIER_CODES[modifier];
      if (held.has(left) && held.has(right)) {
        stopRecording();
        onRecord(
          modifier === "shift" ? { kind: "both-shift-keys" } : { kind: "modifier-pair", modifier },
        );
      }
      return;
    }
    // A global shortcut without a modifier would take that key from every app.
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return;
    const input = keybindingFromKeyboardEvent(event, navigator.platform);
    if (!input) return;
    const next = parseKeybindingShortcut(input);
    if (!next) return;
    stopRecording();
    onRecord(next);
  };

  return {
    recording,
    stopRecording,
    input: (
      <Button
        type="button"
        size="xs"
        variant={recording ? "secondary" : "outline"}
        disabled={disabled}
        aria-label={`Record snapshot shortcut, currently ${formatSnapShotShortcutLabel(shortcut)}`}
        aria-pressed={recording}
        data-keybinding-capture=""
        onClick={() => void startRecording()}
        onKeyDown={recordShortcut}
        onKeyUp={(event) => heldModifierCodes.current.delete(event.code)}
        onBlur={stopRecording}
      >
        {recording ? "Press shortcut…" : <SnapShotShortcutKeys shortcut={shortcut} />}
      </Button>
    ),
  };
}
