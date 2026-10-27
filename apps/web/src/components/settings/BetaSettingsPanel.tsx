import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Features that are still settling in. Each is off until turned on here. */
export function BetaSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title="Beta">
        <SettingsRow
          {...searchableSetting("new-design")}
          description="Try the new design: a true black dark mode, dimmer read threads, and simpler composer controls."
          resetAction={
            settings.redesignEnabled !== DEFAULT_UNIFIED_SETTINGS.redesignEnabled ? (
              <SettingResetButton
                label="new design"
                onClick={() =>
                  updateSettings({ redesignEnabled: DEFAULT_UNIFIED_SETTINGS.redesignEnabled })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.redesignEnabled}
              onCheckedChange={(checked) => updateSettings({ redesignEnabled: Boolean(checked) })}
              aria-label="New design"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("working-shelf")}
          description="Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you."
          resetAction={
            settings.sidebarWorkingShelfEnabled !==
            DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled ? (
              <SettingResetButton
                label="working section"
                onClick={() =>
                  updateSettings({
                    sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarWorkingShelfEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarWorkingShelfEnabled: Boolean(checked) })
              }
              aria-label="Working section"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
