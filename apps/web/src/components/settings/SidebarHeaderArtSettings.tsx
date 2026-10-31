import {
  DEFAULT_UNIFIED_SETTINGS,
  SIDEBAR_HEADER_ART_STYLES,
  type SidebarHeaderArtStyle,
} from "@t3tools/contracts/settings";
import { BanIcon } from "lucide-react";

import { SIDEBAR_ART_STYLE_LABELS } from "../headerArt/StageArt";
import { StageBackdropButtonArt } from "../SidebarStageBackdrop";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import { OptionCard, SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** What "Custom" starts from: Harp's own violet. */
const FIRST_CUSTOM_COLOR = "#7c3aed";

function StyleCard({
  art,
  selected,
  onSelect,
}: {
  art: SidebarHeaderArtStyle;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = art === "off" ? "Off" : SIDEBAR_ART_STYLE_LABELS[art];
  return (
    <OptionCard
      aria-pressed={selected}
      className="flex min-w-0 flex-col gap-1.5 p-1.5"
      data-header-art-style={art}
      onClick={onSelect}
      selected={selected}
    >
      <span aria-hidden className="block h-12 overflow-hidden rounded-lg">
        {art === "off" ? (
          <span className="flex size-full items-center justify-center bg-foreground/[0.03] text-muted-foreground">
            <BanIcon className="size-4" />
          </span>
        ) : (
          <StageBackdropButtonArt variant={art} />
        )}
      </span>
      <span className="truncate px-1 text-xs font-medium text-foreground">{label}</span>
    </OptionCard>
  );
}

export function SidebarHeaderArtSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { sidebarHeaderArtStyle: style, sidebarHeaderArtColor: color } = settings;
  const customColor = color === "theme" ? null : color;

  return (
    <>
      <SettingsRow
        {...searchableSetting("sidebar-header-art")}
        description="Artwork behind the sidebar header, drawn in your theme's colors or the color below."
        resetAction={
          style !== DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtStyle ? (
            <SettingResetButton
              label="sidebar header art"
              onClick={() =>
                updateSettings({
                  sidebarHeaderArtStyle: DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtStyle,
                })
              }
            />
          ) : null
        }
      >
        <div
          aria-label="Sidebar header art style"
          className="grid grid-cols-2 gap-2 pt-3 pb-2 sm:grid-cols-4"
          role="group"
        >
          {SIDEBAR_HEADER_ART_STYLES.map((option) => (
            <StyleCard
              art={option}
              key={option}
              onSelect={() => updateSettings({ sidebarHeaderArtStyle: option })}
              selected={style === option}
            />
          ))}
        </div>
      </SettingsRow>

      <SettingsRow
        {...searchableSetting("sidebar-header-art-color")}
        description="Follow your theme's accent, or tint the art with a color of your own."
        resetAction={
          color !== DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtColor ? (
            <SettingResetButton
              label="sidebar header art color"
              onClick={() =>
                updateSettings({
                  sidebarHeaderArtColor: DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtColor,
                })
              }
            />
          ) : null
        }
        control={
          <div className="flex items-center gap-2">
            <ToggleGroup
              aria-label="Sidebar header art color"
              disabled={style === "off"}
              onValueChange={(next) => {
                if (next[0] === "theme") updateSettings({ sidebarHeaderArtColor: "theme" });
                else if (next[0] === "custom" && customColor === null) {
                  updateSettings({ sidebarHeaderArtColor: FIRST_CUSTOM_COLOR });
                }
              }}
              value={[customColor === null ? "theme" : "custom"]}
            >
              <Toggle value="theme">Theme</Toggle>
              <Toggle value="custom">Custom</Toggle>
            </ToggleGroup>
            {customColor !== null && style !== "off" ? (
              <ProviderAccentColorPicker
                commitDelayMs={120}
                displayName="the sidebar header art"
                layout="inline"
                onCommit={(value) => updateSettings({ sidebarHeaderArtColor: value || "theme" })}
                value={customColor}
              />
            ) : null}
          </div>
        }
      />
    </>
  );
}
