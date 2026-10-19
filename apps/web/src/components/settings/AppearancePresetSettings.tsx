import { MAX_APPEARANCE_PRESETS } from "@t3tools/contracts";
import { PencilIcon, PlusIcon, SaveIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  applyAppearancePreset,
  removeAppearancePreset,
  renameAppearancePreset,
  saveCurrentAppearance,
} from "~/appearancePresetActions";
import { appearanceMatchesPreset } from "~/appearancePresets";
import { useClientSettings } from "~/hooks/useSettings";
import { readThemeState, useTheme } from "~/hooks/useTheme";
import { ensureLocalApi } from "~/localApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type Naming = { readonly mode: "new" } | { readonly mode: "rename"; readonly id: string };

export function AppearancePresetsSection() {
  const settings = useClientSettings();
  // Subscribing keeps the active preset marker in step with theme changes.
  useTheme();
  const themeState = readThemeState();
  const presets = settings.appearancePresets;
  const [naming, setNaming] = useState<Naming | null>(null);
  const [name, setName] = useState("");

  const startNaming = (next: Naming, initialName: string) => {
    setNaming(next);
    setName(initialName);
  };

  const submitName = () => {
    if (naming === null) return;
    const trimmed = name.trim();
    if (naming.mode === "rename") {
      if (trimmed) renameAppearancePreset(naming.id, trimmed);
    } else {
      saveCurrentAppearance({ name: trimmed || `Look ${presets.length + 1}` });
    }
    setNaming(null);
  };

  const confirmDelete = async (id: string, presetName: string) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete the appearance preset "${presetName}"? The current look stays as it is.`,
    );
    if (confirmed) removeAppearancePreset(id);
  };

  return (
    <SettingsSection id="appearance-presets" title="Presets">
      <SettingsRow
        {...searchableSetting("appearance-presets")}
        description="Save the whole look (theme, glass, background image and its effects, corners, fonts and motion) and switch between looks in one click."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((preset) => {
              const active = appearanceMatchesPreset(preset, settings, themeState);
              return (
                <span key={preset.id} className="inline-flex items-center">
                  <Toggle
                    variant="outline"
                    size="sm"
                    pressed={active}
                    onPressedChange={() => applyAppearancePreset(preset)}
                  >
                    {preset.name}
                  </Toggle>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Save the current look into ${preset.name}`}
                    title="Save the current look into this preset"
                    disabled={active}
                    onClick={() => saveCurrentAppearance({ id: preset.id, name: preset.name })}
                  >
                    <SaveIcon />
                  </Button>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Rename ${preset.name}`}
                    onClick={() => startNaming({ mode: "rename", id: preset.id }, preset.name)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Delete ${preset.name}`}
                    onClick={() => void confirmDelete(preset.id, preset.name)}
                  >
                    <XIcon />
                  </Button>
                </span>
              );
            })}
            {naming === null && presets.length < MAX_APPEARANCE_PRESETS ? (
              <Button variant="ghost" size="sm" onClick={() => startNaming({ mode: "new" }, "")}>
                <PlusIcon />
                Save current look
              </Button>
            ) : null}
          </div>
          {naming !== null ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitName();
              }}
            >
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Preset name, e.g. Ocean glass"
                aria-label="Preset name"
              />
              <Button type="submit" size="sm">
                {naming.mode === "rename" ? "Rename" : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNaming(null)}>
                Cancel
              </Button>
            </form>
          ) : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
