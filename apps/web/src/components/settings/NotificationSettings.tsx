import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_HARNESS_SOUND_VOLUME,
  MIN_HARNESS_SOUND_VOLUME,
} from "@t3tools/contracts/settings";
import { type CSSProperties, useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const volume = useScopedSettings((settings) => settings.harnessSoundVolume);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const volumeRatio =
    (volume - MIN_HARNESS_SOUND_VOLUME) / (MAX_HARNESS_SOUND_VOLUME - MIN_HARNESS_SOUND_VOLUME);
  const volumeSliderStyle = {
    "--settings-slider-progress": `${volumeRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - volumeRatio}rem`,
  } as CSSProperties;

  return (
    <>
      <SettingsRow
        {...searchableSetting("thread-notifications")}
        description={
          permissionMessage ??
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while SealCode is open."
        }
        control={
          <Select
            value={mode}
            disabled={requesting}
            onValueChange={async (value) => {
              if (
                value !== "off" &&
                value !== "notifications" &&
                value !== "sound" &&
                value !== "notifications-and-sound"
              )
                return;
              setPermissionMessage(null);
              if (hasNotificationSound(value)) unlockNotificationAudio();
              if (hasDesktopNotifications(value)) {
                if (typeof Notification === "undefined" || !window.isSecureContext) {
                  setPermissionMessage(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  );
                  return;
                }
                setRequesting(true);
                const permission = await settlePromise(() => Notification.requestPermission());
                setRequesting(false);
                if (permission._tag === "Failure") {
                  setPermissionMessage(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  );
                  return;
                }
                if (permission.value !== "granted") {
                  setPermissionMessage(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  );
                  return;
                }
              }
              updateSettings({ notificationMode: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
              <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {hasNotificationSound(mode) ? (
        <SettingsRow
          {...searchableSetting("harness-sound-volume")}
          description="Volume for completed turns, approvals, questions, and errors."
          resetAction={
            volume !== DEFAULT_UNIFIED_SETTINGS.harnessSoundVolume ? (
              <SettingResetButton
                label="sound volume"
                onClick={() =>
                  updateSettings({
                    harnessSoundVolume: DEFAULT_UNIFIED_SETTINGS.harnessSoundVolume,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="harness-sound-volume"
              >
                {volume}%
              </output>
              <input
                aria-label="Sound volume"
                className="settings-slider min-w-0 flex-1"
                id="harness-sound-volume"
                max={MAX_HARNESS_SOUND_VOLUME}
                min={MIN_HARNESS_SOUND_VOLUME}
                onChange={(event) => {
                  const harnessSoundVolume = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(harnessSoundVolume) &&
                    harnessSoundVolume >= MIN_HARNESS_SOUND_VOLUME &&
                    harnessSoundVolume <= MAX_HARNESS_SOUND_VOLUME
                  ) {
                    updateSettings({ harnessSoundVolume });
                  }
                }}
                step={1}
                style={volumeSliderStyle}
                type="range"
                value={volume}
              />
            </div>
          }
        />
      ) : null}
    </>
  );
}
