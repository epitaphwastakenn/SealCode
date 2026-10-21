import type { ComputerUseSettings as ComputerUseSettingsValue } from "@t3tools/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Only the desktop app on Windows can host it, beside the backend it launched. */
export function ComputerUseSettings() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const computerUse = settings.computerUse;
  const update = (patch: Partial<ComputerUseSettingsValue>) =>
    updateSettings({ computerUse: patch });

  return (
    <SettingsSection {...searchableSetting("computer-use")}>
      <p className="px-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
        Let agents see the screen and use the mouse and keyboard on this computer. Each app asks for
        your permission first; browsers stay view only, and terminals and IDEs only take clicks.
        While the agent works, SealCode shrinks to a small panel in the corner of the screen, and
        Esc stops it. Applies to new agent sessions.
      </p>
      <SettingsRow
        title="Computer use"
        description="Offer the computer use tools to Claude threads."
        control={
          <Switch
            checked={computerUse.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
            aria-label="Computer use"
          />
        }
      />
      <SettingsRow
        title="Restore apps when the agent finishes"
        description="Bring back the windows that were minimized to keep apps the agent wasn't allowed to use out of its way."
        control={
          <Switch
            checked={computerUse.restoreHiddenApps}
            disabled={!computerUse.enabled}
            onCheckedChange={(restoreHiddenApps) => update({ restoreHiddenApps })}
            aria-label="Restore apps when the agent finishes"
          />
        }
      />
    </SettingsSection>
  );
}
