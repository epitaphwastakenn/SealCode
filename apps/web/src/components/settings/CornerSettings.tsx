import { DEFAULT_UNIFIED_SETTINGS, MAX_CORNER_RADIUS, MIN_CORNER_RADIUS } from "@t3tools/contracts";
import type { CSSProperties } from "react";

import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function CornerSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const ratio =
    (settings.cornerRadius - MIN_CORNER_RADIUS) / (MAX_CORNER_RADIUS - MIN_CORNER_RADIUS);

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
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              htmlFor="corner-radius-slider"
            >
              {settings.cornerRadius}px
            </output>
            <input
              aria-label="Corner roundness"
              className="settings-slider min-w-0 flex-1"
              id="corner-radius-slider"
              type="range"
              min={MIN_CORNER_RADIUS}
              max={MAX_CORNER_RADIUS}
              step={1}
              style={
                {
                  "--settings-slider-progress": `${ratio * 100}%`,
                  "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
                } as CSSProperties
              }
              value={settings.cornerRadius}
              onChange={(event) => {
                const cornerRadius = Number(event.currentTarget.value);
                if (
                  Number.isInteger(cornerRadius) &&
                  cornerRadius >= MIN_CORNER_RADIUS &&
                  cornerRadius <= MAX_CORNER_RADIUS
                ) {
                  updateSettings({ cornerRadius });
                }
              }}
            />
          </div>
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
        description="Show the sidebar and the main area as separate rounded panels with a small gap around them."
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
