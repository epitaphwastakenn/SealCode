import {
  type AppBackdrop,
  type AppearancePresetTheme,
  backdropFadeDegrees,
  backdropLook,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import type { PresetPreviewLook } from "~/appearancePresets";
import { loadBackdropImage } from "~/lib/backdrop/backdropStore";
import { getThemeDefinition, type ThemeAppearance } from "../../themePalette";
import { cssLevelFilter } from "../AppBackdrop";
import {
  getThemeCardDefinition,
  previewColorsOf,
  STANDARD_THEME_CARDS,
  type ThemeCardPreviewColors,
} from "./ThemePreviewCircles";
import { ThemeWireframe, type ThemeWireframeLook } from "./ThemeWireframe";

const THUMBNAIL_MAX_EDGE = 360;
// The miniature is roughly this share of a window, so a blur in app pixels
// shrinks by the same amount to read the same.
const MINIATURE_SCALE = 0.15;

// Presets share images, and a settings page reopens often; each image is
// decoded once into a small still, which also keeps GIFs from animating here.
const thumbnails = new Map<string, Promise<string | null>>();

async function makeThumbnail(imageId: string): Promise<string | null> {
  const blob = await loadBackdropImage(imageId);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const small = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85),
  );
  return small ? URL.createObjectURL(small) : null;
}

function thumbnailOf(imageId: string): Promise<string | null> {
  let thumbnail = thumbnails.get(imageId);
  if (!thumbnail) {
    thumbnail = makeThumbnail(imageId).catch(() => null);
    thumbnails.set(imageId, thumbnail);
  }
  return thumbnail;
}

function useBackdropThumbnail(imageId: string | null): string | null {
  const [shown, setShown] = useState<{ imageId: string; url: string | null } | null>(null);
  useEffect(() => {
    if (imageId === null) return;
    let cancelled = false;
    void thumbnailOf(imageId).then((url) => {
      if (!cancelled) setShown({ imageId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [imageId]);
  return shown !== null && shown.imageId === imageId ? shown.url : null;
}

function presetColors(
  theme: AppearancePresetTheme,
  appearance: ThemeAppearance,
): ThemeCardPreviewColors {
  const baseId = getThemeDefinition(theme.theme)?.id ?? null;
  const owner = theme[appearance] ?? baseId;
  const definition = owner === null ? null : getThemeDefinition(owner);
  const card = definition ? getThemeCardDefinition(definition) : STANDARD_THEME_CARDS[0]!;
  return previewColorsOf(card, appearance) ?? card.previews[0]!.colors;
}

function BackdropMiniature({
  backdrop,
  url,
  colors,
}: {
  backdrop: AppBackdrop;
  url: string;
  colors: ThemeCardPreviewColors;
}) {
  const look = backdropLook(backdrop);
  const strength = look.strength / 100;
  const blur = look.blur * MINIATURE_SCALE;
  const degrees = backdropFadeDegrees(look);
  // The image's own edge color is only known to the effects worker; the theme
  // background is the closest stand-in for an automatic fade.
  const fade =
    look.fadeColor === null || look.fadeColor === "theme" ? colors.canvas : look.fadeColor;
  return (
    <>
      <img
        src={url}
        alt=""
        draggable={false}
        decoding="async"
        className="absolute inset-0 size-full object-cover"
        style={{
          objectPosition: `${backdrop.x}% ${backdrop.y}%`,
          transformOrigin: `${backdrop.x}% ${backdrop.y}%`,
          transform: `scale(${(backdrop.zoom / 100) * (1 + look.blur / 300)})`,
          opacity: strength,
          filter:
            [blur > 0 ? `blur(${blur}px)` : "", cssLevelFilter(look)].filter(Boolean).join(" ") ||
            undefined,
        }}
      />
      {degrees !== null ? (
        <span
          className="absolute inset-0"
          style={{
            opacity: strength,
            backgroundImage: `linear-gradient(${degrees}deg, transparent ${100 - look.fadeSize}%, ${fade} 100%)`,
          }}
        />
      ) : null}
      {look.vignette > 0 ? (
        <span
          className="absolute inset-0"
          style={{
            opacity: (look.vignette / 100) * strength,
            backgroundImage:
              "radial-gradient(ellipse at center, transparent 40%, rgb(0 0 0 / 0.9) 100%)",
          }}
        />
      ) : null}
    </>
  );
}

/** A miniature of the app as a preset would make it look, drawn from the preset alone. */
export function AppearancePresetPreview({ look }: { look: PresetPreviewLook }) {
  const { settings } = look;
  const backdrop = settings.glassAppEnabled ? settings.backdrop : null;
  const url = useBackdropThumbnail(backdrop?.imageId ?? null);

  const paneLook = (colors: ThemeCardPreviewColors): ThemeWireframeLook => ({
    sidebarOpacity: look.sidebarOpacity,
    panelOpacity: look.panelOpacity,
    floating: settings.floatingPanels,
    backdrop:
      backdrop && url !== null ? (
        <BackdropMiniature backdrop={backdrop} colors={colors} url={url} />
      ) : undefined,
  });
  const pane = (appearance: ThemeAppearance, clip?: "left" | "right") => {
    const colors = presetColors(look.theme, appearance);
    return { colors, look: paneLook(colors), ...(clip ? { clip } : {}) };
  };

  return (
    <ThemeWireframe
      className="h-[6.5rem]"
      radius={settings.cornerRadius}
      panes={
        look.theme.mode === "system"
          ? [pane("light", "left"), pane("dark", "right")]
          : [pane(look.theme.mode)]
      }
    />
  );
}
