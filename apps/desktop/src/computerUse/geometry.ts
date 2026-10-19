/**
 * Screenshots are scaled down to a size vision models read well, and every
 * coordinate the agent sends back is in that image's pixels. Electron's main
 * process is per-monitor DPI aware, so the cursor APIs take physical pixels.
 */
const MAX_LONG_EDGE = 1456;
const MAX_PIXELS = 1_150_000;

export interface PhysicalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenGeometry {
  /** The captured display, in physical pixels. */
  readonly physical: PhysicalRect;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

export function screenshotSize(physicalWidth: number, physicalHeight: number) {
  const scale = Math.min(
    1,
    MAX_LONG_EDGE / Math.max(physicalWidth, physicalHeight),
    Math.sqrt(MAX_PIXELS / (physicalWidth * physicalHeight)),
  );
  return {
    width: Math.max(1, Math.round(physicalWidth * scale)),
    height: Math.max(1, Math.round(physicalHeight * scale)),
  };
}

export function screenGeometry(physical: PhysicalRect): ScreenGeometry {
  const size = screenshotSize(physical.width, physical.height);
  return { physical, imageWidth: size.width, imageHeight: size.height };
}

/** Maps a screenshot pixel to the physical screen point at its center, clamped to the display. */
export function imageToPhysical(geometry: ScreenGeometry, x: number, y: number) {
  const { physical } = geometry;
  const scaleX = physical.width / geometry.imageWidth;
  const scaleY = physical.height / geometry.imageHeight;
  const clamp = (value: number, min: number, size: number) =>
    Math.min(min + size - 1, Math.max(min, value));
  return {
    x: clamp(Math.round(physical.x + (x + 0.5) * scaleX), physical.x, physical.width),
    y: clamp(Math.round(physical.y + (y + 0.5) * scaleY), physical.y, physical.height),
  };
}

export function isInsideImage(geometry: ScreenGeometry, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < geometry.imageWidth && y < geometry.imageHeight;
}
