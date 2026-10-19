import {
  type AppearancePreset,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  MAX_APPEARANCE_PRESETS,
  newAppBackdrop,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appearanceMatchesPreset,
  backdropImageInUse,
  captureAppearanceSettings,
  presetTheme,
  savePreset,
} from "./appearancePresets";

const theme = { theme: "dark", mode: "system", dark: "ocean" } as const;

function presetFrom(settings: ClientSettings, id = "preset-1"): AppearancePreset {
  return {
    id,
    name: "Ocean glass",
    settings: captureAppearanceSettings(settings),
    theme: presetTheme(theme),
  };
}

const glassy: ClientSettings = {
  ...DEFAULT_CLIENT_SETTINGS,
  glassAppEnabled: true,
  panelGlassOpacity: 45,
  cornerRadius: 16,
  backdrop: newAppBackdrop({ imageId: "image-a", imageName: "sea.png", animated: false }),
};

describe("appearance presets", () => {
  it("captures only the look, not behavior settings", () => {
    const captured = captureAppearanceSettings({ ...glassy, confirmQuit: "hold" });
    expect(captured).toMatchObject({
      glassAppEnabled: true,
      panelGlassOpacity: 45,
      cornerRadius: 16,
    });
    expect(captured).not.toHaveProperty("confirmQuit");
    expect(captured).not.toHaveProperty("appearancePresets");
  });

  it("recognizes the preset that matches the current look and theme", () => {
    const preset = presetFrom(glassy);
    expect(appearanceMatchesPreset(preset, glassy, theme)).toBe(true);
    expect(appearanceMatchesPreset(preset, { ...glassy, cornerRadius: 4 }, theme)).toBe(false);
    expect(appearanceMatchesPreset(preset, glassy, { ...theme, dark: "forest" })).toBe(false);
    expect(
      appearanceMatchesPreset(
        preset,
        { ...glassy, backdrop: { ...glassy.backdrop!, blur: 12 } },
        theme,
      ),
    ).toBe(false);
  });

  it("ignores fields an older preset never saved", () => {
    const { fontSizeCode: _dropped, ...settings } = captureAppearanceSettings(glassy);
    const older: AppearancePreset = { ...presetFrom(glassy), settings };
    expect(appearanceMatchesPreset(older, { ...glassy, fontSizeCode: 20 }, theme)).toBe(true);
  });

  it("updates a preset in place and adds new ones up to the limit", () => {
    const first = presetFrom(glassy, "a");
    const renamed = { ...first, name: "Renamed" };
    expect(savePreset([first], renamed)).toEqual([renamed]);
    expect(savePreset([first], presetFrom(glassy, "b")).map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
    const full = Array.from({ length: MAX_APPEARANCE_PRESETS }, (_, index) =>
      presetFrom(glassy, `p${index}`),
    );
    expect(savePreset(full, presetFrom(glassy, "extra"))).toHaveLength(MAX_APPEARANCE_PRESETS);
  });

  it("keeps a background image while the screen or any preset still uses it", () => {
    const presets = [presetFrom(glassy)];
    expect(backdropImageInUse("image-a", { backdrop: null, appearancePresets: presets })).toBe(
      true,
    );
    expect(
      backdropImageInUse("image-a", { backdrop: glassy.backdrop, appearancePresets: [] }),
    ).toBe(true);
    expect(backdropImageInUse("image-a", { backdrop: null, appearancePresets: [] })).toBe(false);
  });
});
