import {
  type AppBackdrop,
  BACKDROP_ANGLE_RANGE,
  BACKDROP_BLUR_RANGE,
  BACKDROP_BRIGHTNESS_RANGE,
  BACKDROP_FADE_SIZE_RANGE,
  BACKDROP_PERCENT_RANGE,
  BACKDROP_PIXEL_RANGE,
  BACKDROP_SATURATION_RANGE,
  BACKDROP_ZOOM_RANGE,
  backdropLook,
  type BackdropLook,
  clearBackdropEffects,
  DEFAULT_UNIFIED_SETTINGS,
  MAX_BACKDROP_STYLES,
  MAX_GLASS_OPACITY,
  MAX_PANEL_GLASS_OPACITY,
  MIN_GLASS_OPACITY,
  MIN_PANEL_GLASS_OPACITY,
  newAppBackdrop,
  sameBackdropLook,
} from "@t3tools/contracts";
import { ImageIcon, PlusIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  deleteBackdropImage,
  isAnimatedImage,
  loadBackdropImage,
  MAX_BACKDROP_IMAGE_BYTES,
  saveBackdropImage,
} from "~/lib/backdrop/backdropStore";
import { randomUUID } from "~/lib/utils";
import { backdropImageInUse } from "~/appearancePresets";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { useThrottledRange } from "~/hooks/useThrottledRange";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
  SettingsSlider,
  settingsSliderStyle,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type NumericLookKey = {
  [Key in keyof BackdropLook]: BackdropLook[Key] extends number ? Key : never;
}[keyof BackdropLook];

type NumericFramingKey = "x" | "y" | "zoom";

interface SliderSpec {
  readonly title: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format?: (value: number) => string;
  /** Animated images only take the effects a CSS filter or overlay can draw. */
  readonly stillOnly?: boolean;
}

const percent = { min: BACKDROP_PERCENT_RANGE.min, max: BACKDROP_PERCENT_RANGE.max, step: 5 };

const FRAMING_SLIDERS: ReadonlyArray<readonly [NumericLookKey | NumericFramingKey, SliderSpec]> = [
  ["strength", { title: "Strength", ...percent }],
  ["blur", { title: "Blur", ...BACKDROP_BLUR_RANGE, step: 2, format: String }],
  ["zoom", { title: "Zoom", ...BACKDROP_ZOOM_RANGE, step: 5 }],
  ["x", { title: "Horizontal position", ...percent }],
  ["y", { title: "Vertical position", ...percent }],
];

const EFFECT_SLIDERS: ReadonlyArray<readonly [NumericLookKey, SliderSpec]> = [
  [
    "pixel",
    { title: "Pixel", ...BACKDROP_PIXEL_RANGE, step: 1, format: (v) => `${v}×`, stillOnly: true },
  ],
  ["dither", { title: "Dither", ...percent, stillOnly: true }],
  ["grain", { title: "Grain", ...percent }],
  ["vignette", { title: "Vignette", ...percent }],
  ["saturation", { title: "Saturation", ...BACKDROP_SATURATION_RANGE, step: 5 }],
  ["brightness", { title: "Brightness", ...BACKDROP_BRIGHTNESS_RANGE, step: 5 }],
  ["duotone", { title: "Duotone (theme colors)", ...percent, stillOnly: true }],
  ["halftone", { title: "Halftone (comic)", ...percent, stillOnly: true }],
  ["edges", { title: "Outline", ...percent, stillOnly: true }],
  ["posterize", { title: "Posterize", ...percent, stillOnly: true }],
  ["bloom", { title: "Bloom", ...percent, stillOnly: true }],
  ["scanlines", { title: "TV lines", ...percent }],
  ["chroma", { title: "Split colors", ...percent, stillOnly: true }],
  ["glitch", { title: "Glitch", ...percent, stillOnly: true }],
  ["hue", { title: "Hue", ...percent, format: (v) => `${Math.trunc((v * 360) / 100)}°` }],
  ["invert", { title: "Negative", ...percent }],
];

function BackdropSlider(props: {
  readonly id: string;
  readonly spec: SliderSpec;
  readonly value: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}) {
  const { spec } = props;
  return (
    <label
      htmlFor={props.id}
      className="flex min-w-0 flex-col gap-1.5 aria-disabled:opacity-50"
      aria-disabled={props.disabled || undefined}
    >
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{props.spec.title}</span>
        <output htmlFor={props.id} className="font-mono text-foreground tabular-nums">
          {spec.format ? spec.format(props.value) : `${props.value}%`}
        </output>
      </span>
      <input
        id={props.id}
        className="settings-slider w-full"
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={props.value}
        disabled={props.disabled}
        style={settingsSliderStyle(props.value, spec.min, spec.max)}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) props.onChange(value);
        }}
      />
    </label>
  );
}

function useBackdropPreview(imageId: string | null): string | null {
  const [loaded, setLoaded] = useState<{ imageId: string; url: string } | null>(null);
  useEffect(() => {
    if (imageId === null) return;
    let cancelled = false;
    let created: string | null = null;
    void loadBackdropImage(imageId).then((blob) => {
      if (cancelled || !blob) return;
      created = URL.createObjectURL(blob);
      setLoaded({ imageId, url: created });
    });
    return () => {
      cancelled = true;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [imageId]);
  return imageId !== null && loaded?.imageId === imageId ? loaded.url : null;
}

export function BackgroundSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const backdrop = settings.backdrop;
  const glassOpacityRange = useThrottledRange(settings.glassOpacity, (glassOpacity) =>
    updateSettings({ glassOpacity }),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preview = useBackdropPreview(backdrop?.imageId ?? null);
  const [namingStyle, setNamingStyle] = useState(false);
  const [styleName, setStyleName] = useState("");

  const updateBackdrop = (patch: Partial<AppBackdrop>) => {
    if (!backdrop) return;
    // A style name only describes the look it was saved with.
    const keepsStyle = Object.keys(patch).every(
      (key) => key === "x" || key === "y" || key === "zoom",
    );
    updateSettings({
      backdrop: { ...backdrop, ...patch, style: keepsStyle ? backdrop.style : null },
    });
  };

  const chooseImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toastManager.add({ type: "error", title: "Choose an image or GIF file." });
      return;
    }
    if (file.size > MAX_BACKDROP_IMAGE_BYTES) {
      toastManager.add({ type: "error", title: "That image is larger than 40 MB." });
      return;
    }
    try {
      const imageId = randomUUID();
      await saveBackdropImage(imageId, file);
      const animated = await isAnimatedImage(file);
      const previousId = backdrop?.imageId ?? null;
      const next = newAppBackdrop({ imageId, imageName: file.name, animated });
      // Swapping the picture keeps the look the user built.
      const nextBackdrop = backdrop
        ? { ...next, ...backdropLook(backdrop), style: backdrop.style }
        : next;
      updateSettings({ glassAppEnabled: true, backdrop: nextBackdrop });
      if (
        previousId !== null &&
        !backdropImageInUse(previousId, {
          backdrop: nextBackdrop,
          appearancePresets: settings.appearancePresets,
        })
      ) {
        void deleteBackdropImage(previousId);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save the image",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const removeImage = () => {
    if (!backdrop) return;
    if (
      !backdropImageInUse(backdrop.imageId, {
        backdrop: null,
        appearancePresets: settings.appearancePresets,
      })
    ) {
      void deleteBackdropImage(backdrop.imageId);
    }
    updateSettings({ backdrop: null });
  };

  const look = backdrop ? backdropLook(backdrop) : null;
  const savedStyle =
    backdrop?.style != null
      ? (settings.backdropStyles.find((style) => style.name === backdrop.style) ?? null)
      : null;
  const isOriginal =
    look !== null && backdrop?.style == null && sameBackdropLook(look, clearBackdropEffects(look));

  const saveStyle = () => {
    if (!look) return;
    const name = styleName.trim() || `My style ${settings.backdropStyles.length + 1}`;
    const others = settings.backdropStyles.filter((style) => style.name !== name);
    if (others.length >= MAX_BACKDROP_STYLES) {
      toastManager.add({
        type: "error",
        title: `You can keep up to ${MAX_BACKDROP_STYLES} styles.`,
      });
      return;
    }
    updateSettings({
      backdropStyles: [...others, { name, look }],
      ...(backdrop ? { backdrop: { ...backdrop, style: name } } : {}),
    });
    setNamingStyle(false);
    setStyleName("");
  };

  const fading = look !== null && look.fade !== "none";

  return (
    <SettingsSection id="appearance-background" title="Glass and background">
      <SettingsRow
        {...searchableSetting("glass-app")}
        description="Make every panel translucent so the window behind the app shows through: the image below, or the desktop's acrylic on Windows."
        resetAction={
          settings.glassAppEnabled !== DEFAULT_UNIFIED_SETTINGS.glassAppEnabled ? (
            <SettingResetButton
              label="glass app"
              onClick={() =>
                updateSettings({ glassAppEnabled: DEFAULT_UNIFIED_SETTINGS.glassAppEnabled })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.glassAppEnabled}
            onCheckedChange={(checked) => updateSettings({ glassAppEnabled: Boolean(checked) })}
            aria-label="Glass app"
          />
        }
      />

      <SettingsRow
        {...searchableSetting("panel-glass-opacity")}
        description="How much the panels cover what is behind them. The theme tints what shows through."
        resetAction={
          settings.panelGlassOpacity !== DEFAULT_UNIFIED_SETTINGS.panelGlassOpacity ? (
            <SettingResetButton
              label="panel glass"
              onClick={() =>
                updateSettings({ panelGlassOpacity: DEFAULT_UNIFIED_SETTINGS.panelGlassOpacity })
              }
            />
          ) : null
        }
        control={
          <SettingsSlider
            label="Panel opacity"
            min={MIN_PANEL_GLASS_OPACITY}
            max={MAX_PANEL_GLASS_OPACITY}
            disabled={!settings.glassAppEnabled}
            format={(value) => (value >= MAX_PANEL_GLASS_OPACITY ? "Solid" : `${value}%`)}
            value={settings.panelGlassOpacity}
            onChange={(panelGlassOpacity) => updateSettings({ panelGlassOpacity })}
          />
        }
      />

      <SettingsRow
        {...searchableSetting("setting-glass-opacity")}
        description="Higher values make menus, dialogs and the composer more solid."
        resetAction={
          settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
            <SettingResetButton
              label="menu and dialog opacity"
              onClick={() =>
                updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
              }
            />
          ) : null
        }
        control={
          <SettingsSlider
            label="Menu and dialog opacity"
            min={MIN_GLASS_OPACITY}
            max={MAX_GLASS_OPACITY}
            step={5}
            value={glassOpacityRange.value}
            onChange={glassOpacityRange.onChange}
            onFinish={glassOpacityRange.onFinish}
          />
        }
      />

      <SettingsRow
        {...searchableSetting("glass-sidebar")}
        description="Render the sidebar as a translucent glass panel over the window background. On Windows this reveals the desktop acrylic material behind the app."
        resetAction={
          settings.glassSidebarEnabled !== DEFAULT_UNIFIED_SETTINGS.glassSidebarEnabled ? (
            <SettingResetButton
              label="glass sidebar"
              onClick={() =>
                updateSettings({
                  glassSidebarEnabled: DEFAULT_UNIFIED_SETTINGS.glassSidebarEnabled,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.glassSidebarEnabled}
            onCheckedChange={(checked) => updateSettings({ glassSidebarEnabled: Boolean(checked) })}
            aria-label="Glass sidebar"
          />
        }
      />

      <SettingsRow
        {...searchableSetting("backdrop-image")}
        description={
          backdrop
            ? backdrop.animated
              ? "An animated image keeps playing behind the glass. Effects marked as still-only need a still image."
              : "Your image behind the glass. It stays on this device."
            : "An image or GIF behind the glass. Turning it on also makes the whole app glass."
        }
        control={
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void chooseImage(file);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon />
              {backdrop ? "Replace" : "Choose image"}
            </Button>
            {backdrop ? (
              <Button variant="ghost-destructive" size="sm" onClick={removeImage}>
                <Trash2Icon />
                Remove
              </Button>
            ) : null}
          </div>
        }
      >
        {backdrop && look ? (
          <div className="flex flex-col gap-5 pt-3 pb-4">
            <div className="flex items-center gap-4">
              <div className="flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {preview ? (
                  <img src={preview} alt="" draggable={false} className="size-full object-cover" />
                ) : (
                  <ImageIcon className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 text-xs text-muted-foreground">
                <div className="truncate font-medium text-foreground">
                  {backdrop.imageName || "Background image"}
                </div>
                {settings.glassAppEnabled ? null : (
                  <div className="mt-1">Turn on Glass app to see it.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {FRAMING_SLIDERS.map(([key, spec]) => (
                <BackdropSlider
                  key={key}
                  id={`backdrop-${key}`}
                  spec={spec}
                  value={backdrop[key]}
                  onChange={(value) => updateBackdrop({ [key]: value } as Partial<AppBackdrop>)}
                />
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Style</span>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isOriginal}
                  onPressedChange={() =>
                    updateBackdrop({ ...clearBackdropEffects(look), style: null })
                  }
                >
                  Original
                </Toggle>
                {settings.backdropStyles.map((style) => {
                  const selected = backdrop.style === style.name;
                  const tweaked =
                    selected && savedStyle !== null && !sameBackdropLook(look, style.look);
                  return (
                    <span key={style.name} className="inline-flex items-center">
                      <Toggle
                        variant="outline"
                        size="sm"
                        pressed={selected}
                        onPressedChange={() =>
                          updateSettings({
                            backdrop: { ...backdrop, ...style.look, style: style.name },
                          })
                        }
                      >
                        {style.name}
                        {tweaked ? <span className="text-muted-foreground">· tweaked</span> : null}
                      </Toggle>
                      <Button
                        variant="ghost-muted"
                        size="icon-xs"
                        aria-label={`Delete style ${style.name}`}
                        onClick={() =>
                          updateSettings({
                            backdropStyles: settings.backdropStyles.filter(
                              (candidate) => candidate.name !== style.name,
                            ),
                            ...(selected ? { backdrop: { ...backdrop, style: null } } : {}),
                          })
                        }
                      >
                        <XIcon />
                      </Button>
                    </span>
                  );
                })}
                {namingStyle ? null : (
                  <Button variant="ghost" size="sm" onClick={() => setNamingStyle(true)}>
                    <PlusIcon />
                    Save as style
                  </Button>
                )}
              </div>
              {namingStyle ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveStyle();
                  }}
                >
                  <Input
                    autoFocus
                    value={styleName}
                    onChange={(event) => setStyleName(event.currentTarget.value)}
                    placeholder="Style name, e.g. Rainy night"
                    aria-label="Style name"
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setNamingStyle(false)}>
                    Cancel
                  </Button>
                </form>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Effects</span>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                {EFFECT_SLIDERS.map(([key, spec]) => (
                  <BackdropSlider
                    key={key}
                    id={`backdrop-${key}`}
                    spec={spec}
                    value={look[key]}
                    disabled={spec.stillOnly === true && backdrop.animated}
                    onChange={(value) => updateBackdrop({ [key]: value } as Partial<AppBackdrop>)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-foreground">Fade into a color</div>
                  <div className="text-xs text-muted-foreground">
                    The image melts into a color toward one side of the window, at any angle.
                  </div>
                </div>
                <Switch
                  checked={fading}
                  aria-label="Fade into a color"
                  onCheckedChange={(checked) =>
                    updateBackdrop({ fade: checked ? "bottom" : "none", fadeAngle: null })
                  }
                />
              </div>
              {fading ? (
                <>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <BackdropSlider
                      id="backdrop-fade-angle"
                      spec={{
                        title: "Angle (0° top, 180° bottom)",
                        ...BACKDROP_ANGLE_RANGE,
                        step: 5,
                        format: (value) => `${value}°`,
                      }}
                      value={
                        look.fadeAngle ??
                        { top: 0, right: 90, bottom: 180, left: 270, none: 180 }[look.fade]
                      }
                      onChange={(value) => updateBackdrop({ fadeAngle: value })}
                    />
                    <BackdropSlider
                      id="backdrop-fade-size"
                      spec={{ title: "Reach", ...BACKDROP_FADE_SIZE_RANGE, step: 5 }}
                      value={look.fadeSize}
                      onChange={(value) => updateBackdrop({ fadeSize: value })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Toggle
                      variant="outline"
                      size="sm"
                      pressed={look.fadeColor === null}
                      onPressedChange={() => updateBackdrop({ fadeColor: null })}
                    >
                      From the image
                    </Toggle>
                    <Toggle
                      variant="outline"
                      size="sm"
                      pressed={look.fadeColor === "theme"}
                      onPressedChange={() => updateBackdrop({ fadeColor: "theme" })}
                    >
                      From the theme
                    </Toggle>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="color"
                        aria-label="Fade color"
                        className="size-7 cursor-pointer rounded-md border bg-transparent"
                        value={
                          look.fadeColor !== null && look.fadeColor.startsWith("#")
                            ? look.fadeColor
                            : "#7c3aed"
                        }
                        onChange={(event) =>
                          updateBackdrop({ fadeColor: event.currentTarget.value })
                        }
                      />
                      Pick a color
                    </label>
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-foreground">Move with the mouse</div>
                  <div className="text-xs text-muted-foreground">
                    The image drifts against the mouse, as if it sat far behind the window.
                  </div>
                </div>
                <Switch
                  checked={look.parallax}
                  aria-label="Move with the mouse"
                  onCheckedChange={(checked) => updateBackdrop({ parallax: Boolean(checked) })}
                />
              </div>
              {look.parallax ? (
                <BackdropSlider
                  id="backdrop-parallax"
                  spec={{ title: "How much it moves", ...percent }}
                  value={look.parallaxAmount}
                  onChange={(value) => updateBackdrop({ parallaxAmount: value })}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
