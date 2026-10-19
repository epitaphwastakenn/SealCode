import {
  APPEARANCE_PRESET_SETTING_KEYS,
  type AppearancePreset,
  type AppearancePresetSettings,
  type AppearancePresetTheme,
  type ClientSettings,
  MAX_APPEARANCE_PRESETS,
} from "@t3tools/contracts";
import * as Struct from "effect/Struct";

import type { ThemeState } from "./hooks/useTheme";

export function captureAppearanceSettings(settings: ClientSettings): AppearancePresetSettings {
  return Struct.pick(settings, APPEARANCE_PRESET_SETTING_KEYS);
}

export function presetTheme(state: ThemeState): AppearancePresetTheme {
  return {
    theme: state.theme,
    mode: state.mode,
    ...(state.light === undefined ? {} : { light: state.light }),
    ...(state.dark === undefined ? {} : { dark: state.dark }),
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).filter(
    (key) => (left as Record<string, unknown>)[key] !== undefined,
  );
  const rightKeys = Object.keys(right).filter(
    (key) => (right as Record<string, unknown>)[key] !== undefined,
  );
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

/** Whether the app looks exactly like the preset right now. */
export function appearanceMatchesPreset(
  preset: AppearancePreset,
  settings: ClientSettings,
  theme: ThemeState,
): boolean {
  const current = captureAppearanceSettings(settings);
  const settingsMatch = APPEARANCE_PRESET_SETTING_KEYS.every(
    (key) => preset.settings[key] === undefined || sameValue(preset.settings[key], current[key]),
  );
  return (
    settingsMatch && (preset.theme === undefined || sameValue(preset.theme, presetTheme(theme)))
  );
}

/** Saves a preset in place when its id exists, otherwise adds it at the end. */
export function savePreset(
  presets: ReadonlyArray<AppearancePreset>,
  preset: AppearancePreset,
): ReadonlyArray<AppearancePreset> {
  if (presets.some((entry) => entry.id === preset.id)) {
    return presets.map((entry) => (entry.id === preset.id ? preset : entry));
  }
  return presets.length >= MAX_APPEARANCE_PRESETS ? presets : [...presets, preset];
}

export function renamePreset(
  presets: ReadonlyArray<AppearancePreset>,
  id: string,
  name: string,
): ReadonlyArray<AppearancePreset> {
  return presets.map((entry) => (entry.id === id ? { ...entry, name } : entry));
}

export function deletePreset(
  presets: ReadonlyArray<AppearancePreset>,
  id: string,
): ReadonlyArray<AppearancePreset> {
  return presets.filter((entry) => entry.id !== id);
}

/**
 * Background images live once in this device's image store and presets point
 * at them, so an image may only be deleted when nothing points at it anymore.
 */
export function backdropImageInUse(
  imageId: string,
  state: Pick<ClientSettings, "backdrop" | "appearancePresets">,
): boolean {
  return (
    state.backdrop?.imageId === imageId ||
    state.appearancePresets.some((preset) => preset.settings.backdrop?.imageId === imageId)
  );
}
