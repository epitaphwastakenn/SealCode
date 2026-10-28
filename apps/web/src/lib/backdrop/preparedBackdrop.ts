import {
  type AppBackdrop,
  backdropLook,
  type BackdropLook,
  DEFAULT_BACKDROP_LOOK,
} from "@t3tools/contracts";

import { loadBackdropImage } from "./backdropStore";
import {
  type BackdropLane,
  type BackdropPalette,
  type EdgeColors,
  processBackdropImage,
  revokeBackdropUrl,
} from "./processBackdrop";

const DECODE_WAIT_MS = 500;

export interface PreparedBackdrop {
  readonly key: string;
  readonly imageId: string;
  /** An object URL, owned by whoever received it; hand it to `revokeBackdropUrl` when done. */
  readonly url: string;
  readonly edges: EdgeColors;
}

/** Resolves any CSS color (hex, rgb, oklch…) to RGB through a 1×1 canvas. */
function cssColorToRgb(color: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0];
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function readThemePalette(): BackdropPalette {
  const style = getComputedStyle(document.documentElement);
  return {
    base: cssColorToRgb(style.getPropertyValue("--background").trim() || "#000"),
    accent: cssColorToRgb(style.getPropertyValue("--primary").trim() || "#7c3aed"),
  };
}

export function pixelLookKey(look: BackdropLook): string {
  // Strength, blur, the fade, the vignette and the drift are drawn in CSS, so
  // changing them must not send the image back through the effects worker.
  const {
    strength: _strength,
    blur: _blur,
    vignette: _vignette,
    fade: _fade,
    fadeAngle: _fadeAngle,
    fadeSize: _fadeSize,
    fadeColor: _fadeColor,
    parallax: _parallax,
    parallaxAmount: _parallaxAmount,
    ...pixel
  } = look;
  return JSON.stringify(pixel);
}

/**
 * Changes exactly when the effects worker has to run again. The theme colors only reach the
 * pixels through the duotone, so a light/dark flip leaves every other look alone.
 */
export function backdropProcessKey(backdrop: AppBackdrop, theme: string): string {
  if (backdrop.animated) return `${backdrop.imageId}:animated`;
  const look = backdropLook(backdrop);
  return `${backdrop.imageId}:${pixelLookKey(look)}${look.duotone > 0 ? `:${theme}` : ""}`;
}

/** Two backdrops with the same key come out of the effects worker as the same picture. */
function preparedBackdropKey(backdrop: AppBackdrop, palette: BackdropPalette): string {
  if (backdrop.animated) return `${backdrop.imageId}:animated`;
  const look = backdropLook(backdrop);
  // The theme colors only reach the pixels through the duotone.
  const colors = look.duotone > 0 ? `:${palette.base.join()}/${palette.accent.join()}` : "";
  return `${backdrop.imageId}:${pixelLookKey(look)}${colors}`;
}

async function prepare(
  backdrop: AppBackdrop,
  palette: BackdropPalette,
  lane: BackdropLane,
): Promise<PreparedBackdrop> {
  const blob = await loadBackdropImage(backdrop.imageId);
  if (!blob) throw new Error("The background image is not on this device");
  // Animated images play as they are; the worker still reads their first
  // frame for the edge colors the automatic fade melts into.
  const result = await processBackdropImage(
    blob,
    backdrop.animated ? DEFAULT_BACKDROP_LOOK : backdropLook(backdrop),
    palette,
    lane,
  );
  let url = result.url;
  if (backdrop.animated) {
    revokeBackdropUrl(result.url);
    url = URL.createObjectURL(blob);
  }
  // Decoded before anyone shows it, so swapping it in paints at once. A window
  // that is hidden never settles `decode()`, so it only gets a head start once
  // the image has loaded.
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("The image did not load")), {
        once: true,
      });
      image.src = url;
    });
    await Promise.race([
      image.decode().catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, DECODE_WAIT_MS)),
    ]);
  } catch (error) {
    revokeBackdropUrl(url);
    throw error;
  }
  return {
    key: preparedBackdropKey(backdrop, palette),
    imageId: backdrop.imageId,
    url,
    edges: result.edges,
  };
}

// One slot: the look under the pointer. Warming every preset at once would
// decode several full-window images for nothing.
let prefetched: { readonly key: string; readonly result: Promise<PreparedBackdrop> } | null = null;

function discardPrefetched(): void {
  const stale = prefetched;
  prefetched = null;
  void stale?.result.then(
    (prepared) => revokeBackdropUrl(prepared.url),
    () => undefined,
  );
}

/**
 * Starts getting a backdrop ready, so showing it right after costs nothing.
 * The duotone is colored with the theme on screen now; if showing the
 * backdrop also changes the theme, it is simply prepared again.
 */
export function prefetchBackdrop(backdrop: AppBackdrop, current: AppBackdrop | null): void {
  const palette = readThemePalette();
  const key = preparedBackdropKey(backdrop, palette);
  if (prefetched?.key === key) return;
  if (current !== null && preparedBackdropKey(current, palette) === key) return;
  discardPrefetched();
  const result = prepare(backdrop, palette, "prefetch");
  result.catch(() => undefined);
  prefetched = { key, result };
}

/** The backdrop processed and decoded, taken from the prefetch when it matches. */
export function prepareBackdrop(backdrop: AppBackdrop): Promise<PreparedBackdrop> {
  const palette = readThemePalette();
  const key = preparedBackdropKey(backdrop, palette);
  if (prefetched?.key === key) {
    const { result } = prefetched;
    prefetched = null;
    return result.catch(() => prepare(backdrop, palette, "live"));
  }
  return prepare(backdrop, palette, "live");
}
