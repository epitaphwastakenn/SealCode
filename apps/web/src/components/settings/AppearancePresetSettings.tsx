import { MAX_APPEARANCE_PRESETS } from "@t3tools/contracts";
import { PencilIcon, PlusIcon, SaveIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  applyAppearancePreset,
  removeAppearancePreset,
  renameAppearancePreset,
  saveCurrentAppearance,
} from "~/appearancePresetActions";
import { appearanceFontStack, DEFAULT_SANS_FONT_STACK } from "~/appearanceFonts";
import { appearanceMatchesPreset, presetPreviewLook } from "~/appearancePresets";
import { useClientSettings } from "~/hooks/useSettings";
import { readThemeState, useTheme } from "~/hooks/useTheme";
import { ensureLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { AppearancePresetPreview } from "./AppearancePresetPreview";
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
          <div
            className="grid gap-3 empty:hidden"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 11rem), 1fr))" }}
          >
            {presets.map((preset) => {
              const active = appearanceMatchesPreset(preset, settings, themeState);
              const look = presetPreviewLook(preset, settings, themeState);
              return (
                <div
                  key={preset.id}
                  className={cn(
                    "flex min-w-0 flex-col gap-1.5 rounded-xl border p-2 transition-colors",
                    active
                      ? "border-transparent bg-accent/30"
                      : "border-border/70 bg-card/60 hover:bg-accent/10",
                  )}
                  style={active ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
                >
                  <button
                    type="button"
                    aria-label={`Apply ${preset.name}`}
                    aria-pressed={active}
                    className="cursor-pointer rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
                    onClick={() => applyAppearancePreset(preset)}
                  >
                    <AppearancePresetPreview look={look} />
                  </button>
                  <div className="flex min-w-0 items-center gap-0.5">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate px-1 text-xs font-medium",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                      style={{
                        fontFamily: appearanceFontStack(
                          look.settings.fontFamilySans,
                          DEFAULT_SANS_FONT_STACK,
                        ),
                      }}
                    >
                      {preset.name}
                    </span>
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
                  </div>
                </div>
              );
            })}
          </div>
          {naming === null && presets.length < MAX_APPEARANCE_PRESETS ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => startNaming({ mode: "new" }, "")}>
                <PlusIcon />
                Save current look
              </Button>
            </div>
          ) : null}
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
