import { DEFAULT_UNIFIED_SETTINGS, MAX_CORNER_RADIUS, MIN_CORNER_RADIUS } from "@t3tools/contracts";

import { useThrottledRange } from "../../hooks/useThrottledRange";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection, SettingsSlider } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function CornerSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const cornerRadiusRange = useThrottledRange(settings.cornerRadius, (cornerRadius) =>
    updateSettings({ cornerRadius }),
  );

  return (
    <SettingsSection id="appearance-corners" title="Corners">
      <SettingsRow
        {...searchableSetting("corner-radius")}
        description="How round buttons, menus, cards, the composer and every other surface are."
        resetAction={
          settings.cornerRadius !== DEFAULT_UNIFIED_SETTINGS.cornerRadius ? (
            <SettingResetButton
              label="corner roundness"
              onClick={() =>
                updateSettings({ cornerRadius: DEFAULT_UNIFIED_SETTINGS.cornerRadius })
              }
            />
          ) : null
        }
        control={
          <SettingsSlider
            label="Corner roundness"
            min={MIN_CORNER_RADIUS}
            max={MAX_CORNER_RADIUS}
            format={(value) => `${value}px`}
            value={cornerRadiusRange.value}
            onChange={cornerRadiusRange.onChange}
            onFinish={cornerRadiusRange.onFinish}
          />
        }
      />

      <SettingsRow
        {...searchableSetting("smooth-corners")}
        description="Continuous, squircle-shaped corners instead of plain arcs, like on a phone."
        resetAction={
          settings.smoothCorners !== DEFAULT_UNIFIED_SETTINGS.smoothCorners ? (
            <SettingResetButton
              label="smooth corners"
              onClick={() =>
                updateSettings({ smoothCorners: DEFAULT_UNIFIED_SETTINGS.smoothCorners })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.smoothCorners}
            onCheckedChange={(checked) => updateSettings({ smoothCorners: Boolean(checked) })}
            aria-label="Smooth corners"
          />
        }
      />

      <SettingsRow
        {...searchableSetting("floating-panels")}
        description="Show the sidebar and the main area as separate rounded panels with a small gap around them. In the Windows app the gaps are see-through, so only the panels stay on the desktop, and the window buttons move into the panel the next time the app starts."
        resetAction={
          settings.floatingPanels !== DEFAULT_UNIFIED_SETTINGS.floatingPanels ? (
            <SettingResetButton
              label="floating panels"
              onClick={() =>
                updateSettings({ floatingPanels: DEFAULT_UNIFIED_SETTINGS.floatingPanels })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.floatingPanels}
            onCheckedChange={(checked) => updateSettings({ floatingPanels: Boolean(checked) })}
            aria-label="Floating panels"
          />
        }
      />
    </SettingsSection>
  );
}
