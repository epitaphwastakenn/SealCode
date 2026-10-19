import type { AppearancePreset, ClientSettings } from "@t3tools/contracts";

import {
  backdropImageInUse,
  captureAppearanceSettings,
  deletePreset,
  presetTheme,
  renamePreset,
  savePreset,
} from "./appearancePresets";
import { getClientSettings, persistClientSettingsPatch } from "./hooks/useSettings";
import { applyThemeState, readThemeState } from "./hooks/useTheme";
import { deleteBackdropImage } from "./lib/backdrop/backdropStore";
import { randomUUID } from "./lib/utils";

export function applyAppearancePreset(preset: AppearancePreset): void {
  void persistClientSettingsPatch(preset.settings);
  if (preset.theme !== undefined) applyThemeState(preset.theme);
}

function storePresets(
  current: ClientSettings,
  next: ReadonlyArray<AppearancePreset>,
  replaced: AppearancePreset | undefined,
): void {
  void persistClientSettingsPatch({ appearancePresets: next });
  const imageId = replaced?.settings.backdrop?.imageId;
  if (
    imageId !== undefined &&
    !backdropImageInUse(imageId, { backdrop: current.backdrop, appearancePresets: next })
  ) {
    void deleteBackdropImage(imageId);
  }
}

/** Saves the look on screen now, into the preset `id` when given or as a new one. */
export function saveCurrentAppearance(input: { readonly id?: string; readonly name: string }) {
  const current = getClientSettings();
  const preset: AppearancePreset = {
    id: input.id ?? randomUUID(),
    name: input.name,
    settings: captureAppearanceSettings(current),
    theme: presetTheme(readThemeState()),
  };
  const replaced = current.appearancePresets.find((entry) => entry.id === preset.id);
  storePresets(current, savePreset(current.appearancePresets, preset), replaced);
}

export function renameAppearancePreset(id: string, name: string): void {
  const current = getClientSettings();
  void persistClientSettingsPatch({
    appearancePresets: renamePreset(current.appearancePresets, id, name),
  });
}

export function removeAppearancePreset(id: string): void {
  const current = getClientSettings();
  const removed = current.appearancePresets.find((entry) => entry.id === id);
  storePresets(current, deletePreset(current.appearancePresets, id), removed);
}
