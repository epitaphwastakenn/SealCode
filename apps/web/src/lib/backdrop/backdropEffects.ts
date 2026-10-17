import type { BackdropLook } from "@t3tools/contracts";

/**
 * The backdrop's pixel effects, ported from SealScreen's Rust (`ui/backdrop.rs`) so
 * the same sliders give the same looks. Everything here runs over raw RGBA bytes and
 * touches no DOM, so it works in the worker and under test.
 *
 * Typed-array reads carry a `!` throughout: every index is derived from the image
 * size, and the assertions only satisfy `noUncheckedIndexedAccess`.
 */

export type Rgb = readonly [number, number, number];

/** The pixels of an `ImageData`, without needing a DOM to build one. */
export interface ImageDataLike {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** The theme colors a duotone is drawn between, 0-255 per channel. */
export interface BackdropPalette {
  base: Rgb;
  accent: Rgb;
}

export interface EdgeColors {
  top: Rgb;
  right: Rgb;
  bottom: Rgb;
  left: Rgb;
}

/** The part of a look that changes pixels; the rest is done in CSS. */
export type BackdropPixelLook = Pick<
  BackdropLook,
  | "saturation"
  | "brightness"
  | "hue"
  | "invert"
  | "duotone"
  | "posterize"
  | "edges"
  | "bloom"
  | "halftone"
  | "pixel"
  | "dither"
  | "scanlines"
  | "chroma"
  | "glitch"
  | "grain"
>;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// Separate streams so grain does not follow the glitch's draws.
const GLITCH_SALT = 0x9e3779b9;
const GRAIN_SALT = 0x85ebca6b;

/** 4x4 Bayer thresholds, 0 to 15, row by row. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export function hasPixelEffects(look: BackdropPixelLook): boolean {
  return (
    look.saturation !== 100 ||
    look.brightness !== 100 ||
    look.hue > 0 ||
    look.invert > 0 ||
    look.duotone > 0 ||
    look.posterize > 0 ||
    look.edges > 0 ||
    look.bloom > 0 ||
    look.halftone > 0 ||
    look.pixel > 1 ||
    look.dither > 0 ||
    look.scanlines > 0 ||
    look.chroma > 0 ||
    look.glitch > 0 ||
    look.grain > 0
  );
}

/**
 * The look applied to a copy of `image`, in the order the sliders are listed; the
 * input is returned untouched when nothing applies. `seed` fixes the grain and the
 * glitch, so the same look on the same image always comes out the same.
 */
export function applyBackdropEffects(
  image: ImageDataLike,
  look: BackdropPixelLook,
  palette: BackdropPalette,
  seed: number,
): ImageDataLike {
  const { width, height } = image;
  if (!hasPixelEffects(look) || width < 1 || height < 1) return image;

  const data = image.data.slice();
  // One logical dot of the dither and grain is about a pixel of a 1280-wide window,
  // so they survive the browser scaling a large image down.
  const dotSize = look.pixel > 1 ? look.pixel : Math.max(1, Math.round(width / 1280));

  adjustColors(data, look, palette);
  if (look.edges > 0) outline(data, width, height, look.edges);
  if (look.bloom > 0) glow(data, width, height, look.bloom);
  if (look.halftone > 0) halftone(data, width, height, look.halftone);
  if (look.pixel > 1) pixelate(data, width, height, look.pixel);
  if (look.dither > 0) dither(data, width, height, look.dither, dotSize);
  if (look.scanlines > 0) scanlines(data, width, height, look.scanlines);
  if (look.chroma > 0) splitColors(data, width, height, look.chroma);
  if (look.glitch > 0) glitch(data, width, height, look.glitch, mulberry32(seed ^ GLITCH_SALT));
  if (look.grain > 0)
    grain(data, width, height, look.grain, dotSize, mulberry32(seed ^ GRAIN_SALT));

  return { data, width, height };
}

/** The average color of a strip about 4% thick along each edge, for a fade into the image's own edge. */
export function edgeColors(image: ImageDataLike): EdgeColors {
  const { data, width, height } = image;
  const bandWidth = Math.max(1, Math.round(width * 0.04));
  const bandHeight = Math.max(1, Math.round(height * 0.04));

  const average = (x0: number, x1: number, y0: number, y1: number): Rgb => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      let i = (y * width + x0) * 4;
      for (let x = x0; x < x1; x++, i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count++;
      }
    }
    if (count === 0) return [0, 0, 0];
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  };

  return {
    top: average(0, width, 0, Math.min(bandHeight, height)),
    right: average(Math.max(0, width - bandWidth), width, 0, height),
    bottom: average(0, width, Math.max(0, height - bandHeight), height),
    left: average(0, Math.min(bandWidth, width), 0, height),
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Saturation, brightness, hue, invert, duotone and posterize in one walk over the
 * pixels: they are all per-pixel, and each extra pass over a large image costs more
 * than the math does.
 */
function adjustColors(
  data: Uint8ClampedArray,
  look: BackdropPixelLook,
  palette: BackdropPalette,
): void {
  const recolor = look.saturation !== 100 || look.brightness !== 100;
  const turn = look.hue > 0;
  const invert = Math.min(look.invert, 100) / 100;
  const duotone = Math.min(look.duotone, 100) / 100;
  if (!recolor && !turn && invert === 0 && duotone === 0 && look.posterize <= 0) return;

  const saturation = look.saturation / 100;
  const brightness = look.brightness / 100;

  // Rotation of the color cube around the gray axis, as in CSS `hue-rotate`.
  const angle = (look.hue / 100) * Math.PI * 2;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const m00 = 0.213 + 0.787 * cos - 0.213 * sin;
  const m01 = 0.715 - 0.715 * cos - 0.715 * sin;
  const m02 = 0.072 - 0.072 * cos + 0.928 * sin;
  const m10 = 0.213 - 0.213 * cos + 0.143 * sin;
  const m11 = 0.715 + 0.285 * cos + 0.14 * sin;
  const m12 = 0.072 - 0.072 * cos - 0.283 * sin;
  const m20 = 0.213 - 0.213 * cos - 0.787 * sin;
  const m21 = 0.715 - 0.715 * cos + 0.715 * sin;
  const m22 = 0.072 + 0.928 * cos + 0.072 * sin;

  const [baseR, baseG, baseB] = palette.base;
  const [accentR, accentG, accentB] = palette.accent;
  const darkR = baseR * 0.65;
  const darkG = baseG * 0.65;
  const darkB = baseB * 0.65;
  const lightR = accentR + (255 - accentR) * 0.15;
  const lightG = accentG + (255 - accentG) * 0.15;
  const lightB = accentB + (255 - accentB) * 0.15;

  const posterize = look.posterize > 0;
  const levels = Math.round(2 + (1 - Math.min(look.posterize, 100) / 100) ** 1.5 * 22);
  const steps = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    steps[v] = Math.round((Math.round((v / 255) * (levels - 1)) / (levels - 1)) * 255);
  }

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;

    if (recolor) {
      const gray = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      r = clamp255((gray + (r - gray) * saturation) * brightness);
      g = clamp255((gray + (g - gray) * saturation) * brightness);
      b = clamp255((gray + (b - gray) * saturation) * brightness);
    }
    if (turn) {
      const nr = clamp255(m00 * r + m01 * g + m02 * b);
      const ng = clamp255(m10 * r + m11 * g + m12 * b);
      b = clamp255(m20 * r + m21 * g + m22 * b);
      r = nr;
      g = ng;
    }
    if (invert > 0) {
      r += (255 - 2 * r) * invert;
      g += (255 - 2 * g) * invert;
      b += (255 - 2 * b) * invert;
    }
    if (duotone > 0) {
      const light = Math.min(1, Math.max(0, (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255));
      r += (darkR + (lightR - darkR) * light - r) * duotone;
      g += (darkG + (lightG - darkG) * light - g) * duotone;
      b += (darkB + (lightB - darkB) * light - b) * duotone;
    }
    if (posterize) {
      r = steps[(r + 0.5) | 0]!;
      g = steps[(g + 0.5) | 0]!;
      b = steps[(b + 0.5) | 0]!;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Dark ink where the picture changes sharply: a Sobel gradient of the lightness. */
function outline(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  if (width < 3 || height < 3) return;

  const light = new Uint8ClampedArray(width * height);
  for (let p = 0, i = 0; p < light.length; p++, i += 4) {
    light[p] = LUMA_R * data[i]! + LUMA_G * data[i + 1]! + LUMA_B * data[i + 2]!;
  }

  // Lines about as thick on screen whatever the picture's size.
  const step = Math.max(1, Math.round(width / 1100));
  const strength = (Math.min(amount, 100) / 100) * 0.92;

  for (let y = 0; y < height; y++) {
    const above = Math.max(0, y - step) * width;
    const here = y * width;
    const below = Math.min(height - 1, y + step) * width;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - step);
      const right = Math.min(width - 1, x + step);
      const gx =
        light[above + right]! +
        2 * light[here + right]! +
        light[below + right]! -
        light[above + left]! -
        2 * light[here + left]! -
        light[below + left]!;
      const gy =
        light[below + left]! +
        2 * light[below + x]! +
        light[below + right]! -
        light[above + left]! -
        2 * light[above + x]! -
        light[above + right]!;
      const magnitude = Math.sqrt(gx * gx + gy * gy) / 255;
      if (magnitude <= 0.22) continue;

      const keep = 1 - smoothstep(0.22, 0.85, magnitude) * strength;
      const i = (here + x) * 4;
      data[i] = data[i]! * keep;
      data[i + 1] = data[i + 1]! * keep;
      data[i + 2] = data[i + 2]! * keep;
    }
  }
}

/** Box-blur widths whose three passes approximate a Gaussian of `sigma`. */
function boxSizes(sigma: number, passes: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  lower = Math.max(1, lower);
  const upper = lower + 2;
  const wide = Math.round(
    (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) /
      (-4 * lower - 4),
  );
  return Array.from({ length: passes }, (_, pass) => (pass < wide ? lower : upper));
}

/** Blurs one line of `buf` (every `stride`th value from `start`), edges extended. */
function boxBlurLine(
  buf: Float32Array,
  line: Float32Array,
  start: number,
  stride: number,
  length: number,
  radius: number,
): void {
  for (let i = 0; i < length; i++) line[i] = buf[start + i * stride]!;
  const size = 2 * radius + 1;
  let sum = line[0]! * radius;
  for (let j = 0; j <= radius; j++) sum += line[Math.min(j, length - 1)]!;
  for (let i = 0; i < length; i++) {
    buf[start + i * stride] = sum / size;
    sum += line[Math.min(i + radius + 1, length - 1)]! - line[Math.max(i - radius, 0)]!;
  }
}

/**
 * Highlights glowing past their edges. The glow is soft by nature, so it is built
 * on a copy shrunk until its blur is a few pixels wide, then stretched back: the
 * same look for a fraction of the work.
 */
function glow(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const sigma = Math.max(2, (width / 1600) * 18);
  const factor = Math.max(1, Math.floor(sigma / 6));
  const lowWidth = Math.ceil(width / factor);
  const lowHeight = Math.ceil(height / factor);
  const low = new Float32Array(lowWidth * lowHeight * 3);

  for (let y = 0; y < height; y++) {
    const rowStart = Math.floor(y / factor) * lowWidth * 3;
    let i = y * width * 4;
    let column = 0;
    let within = 0;
    for (let x = 0; x < width; x++, i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const light = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255;
      if (light > 0.5) {
        const keep = smoothstep(0.5, 0.95, light);
        const k = rowStart + column * 3;
        low[k] = low[k]! + r * keep;
        low[k + 1] = low[k + 1]! + g * keep;
        low[k + 2] = low[k + 2]! + b * keep;
      }
      if (++within === factor) {
        within = 0;
        column++;
      }
    }
  }
  for (let ly = 0; ly < lowHeight; ly++) {
    const rows = Math.min(factor, height - ly * factor);
    for (let lx = 0; lx < lowWidth; lx++) {
      const count = rows * Math.min(factor, width - lx * factor);
      const k = (ly * lowWidth + lx) * 3;
      low[k] = low[k]! / count;
      low[k + 1] = low[k + 1]! / count;
      low[k + 2] = low[k + 2]! / count;
    }
  }

  const line = new Float32Array(Math.max(lowWidth, lowHeight));
  for (const size of boxSizes(sigma / factor, 3)) {
    const radius = (size - 1) / 2;
    for (let ly = 0; ly < lowHeight; ly++) {
      for (let c = 0; c < 3; c++)
        boxBlurLine(low, line, ly * lowWidth * 3 + c, 3, lowWidth, radius);
    }
    for (let lx = 0; lx < lowWidth; lx++) {
      for (let c = 0; c < 3; c++) {
        boxBlurLine(low, line, lx * 3 + c, lowWidth * 3, lowHeight, radius);
      }
    }
  }

  const strength = (Math.min(amount, 100) / 100) * 1.6;
  const left = new Int32Array(width);
  const right = new Int32Array(width);
  const across = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const at = Math.min(lowWidth - 1, Math.max(0, (x + 0.5) / factor - 0.5));
    const from = Math.floor(at);
    left[x] = from * 3;
    right[x] = Math.min(from + 1, lowWidth - 1) * 3;
    across[x] = at - from;
  }

  const blended = new Float32Array(lowWidth * 3);
  for (let y = 0; y < height; y++) {
    const at = Math.min(lowHeight - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const from = Math.floor(at);
    const next = Math.min(from + 1, lowHeight - 1);
    const down = at - from;
    for (let k = 0; k < blended.length; k++) {
      const a = low[from * lowWidth * 3 + k]!;
      blended[k] = a + (low[next * lowWidth * 3 + k]! - a) * down;
    }
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const l = left[x]!;
      const r = right[x]!;
      const f = across[x]!;
      for (let c = 0; c < 3; c++) {
        const light = blended[l + c]! + (blended[r + c]! - blended[l + c]!) * f;
        const added = Math.min(1, (light / 255) * strength);
        if (added <= 0.0005) continue;
        // Screen blend: light only ever brightens.
        const base = data[i + c]! / 255;
        data[i + c] = (1 - (1 - base) * (1 - added)) * 255;
      }
    }
  }
}

/**
 * Comic-book printing: each cell becomes a dot of ink on paper of its own color,
 * bigger where it is darker, every other row shifted half a cell as in print.
 */
function halftone(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const cell = Math.max(3, (width / 1600) * 10);
  const strength = Math.min(amount, 100) / 100;
  const stride = 7;

  // Cell (row, column) holds its paper color, its ink color and its dot radius. Column
  // -1 exists because odd rows are shifted half a cell and start in the middle of one.
  const rows = Math.ceil(height / cell) + 1;
  const columns = Math.ceil(width / cell) + 2;
  const cells = new Float32Array(rows * columns * stride);
  const sampleStep = Math.max(1, Math.floor(cell / 4));
  for (let row = 0; row < rows; row++) {
    const shift = row % 2 === 1 ? 0.5 : 0;
    const y0 = Math.min(height - 1, Math.floor(row * cell));
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((row + 1) * cell)));
    for (let column = 0; column < columns; column++) {
      const x0 = Math.min(width - 1, Math.max(0, Math.floor((column - 1 + shift) * cell)));
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((column + shift) * cell)));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y += sampleStep) {
        for (let x = x0; x < x1; x += sampleStep) {
          const i = (y * width + x) * 4;
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          count++;
        }
      }
      r /= count;
      g /= count;
      b /= count;
      const k = (row * columns + column) * stride;
      cells[k] = r + (255 - r) * 0.55;
      cells[k + 1] = g + (255 - g) * 0.55;
      cells[k + 2] = b + (255 - b) * 0.55;
      cells[k + 3] = r * 0.22;
      cells[k + 4] = g * 0.22;
      cells[k + 5] = b * 0.22;
      const light = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255;
      cells[k + 6] = cell * 0.54 * Math.sqrt(Math.max(0, 1 - light));
    }
  }

  // Which cell each x falls in, and how far it is from that dot's center, once per
  // row parity instead of once per pixel.
  const evenColumn = new Int32Array(width);
  const oddColumn = new Int32Array(width);
  const evenDx2 = new Float32Array(width);
  const oddDx2 = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const even = Math.floor(x / cell);
    const odd = Math.floor(x / cell - 0.5);
    evenColumn[x] = even + 1;
    oddColumn[x] = odd + 1;
    evenDx2[x] = (x + 0.5 - (even + 0.5) * cell) ** 2;
    oddDx2[x] = (x + 0.5 - (odd + 1) * cell) ** 2;
  }

  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell);
    const odd = row % 2 === 1;
    const columnOf = odd ? oddColumn : evenColumn;
    const dx2Of = odd ? oddDx2 : evenDx2;
    const dy2 = (y + 0.5 - (row + 0.5) * cell) ** 2;
    const rowStart = row * columns;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const k = (rowStart + columnOf[x]!) * stride;
      const reach = cells[k + 6]! + 0.5;
      const d2 = dx2Of[x]! + dy2;
      const ink = d2 < reach * reach ? Math.min(1, reach - Math.sqrt(d2)) : 0;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const paperR = cells[k]!;
      const paperG = cells[k + 1]!;
      const paperB = cells[k + 2]!;
      data[i] = r + (paperR + (cells[k + 3]! - paperR) * ink - r) * strength;
      data[i + 1] = g + (paperG + (cells[k + 4]! - paperG) * ink - g) * strength;
      data[i + 2] = b + (paperB + (cells[k + 5]! - paperB) * ink - b) * strength;
    }
  }
}

/** Every `block`x`block` square replaced by its average. */
function pixelate(data: Uint8ClampedArray, width: number, height: number, block: number): void {
  const blocks = Math.ceil(width / block);
  const sums = new Uint32Array(blocks * 4);
  const packed = new Uint32Array(1);
  const packedBytes = new Uint8Array(packed.buffer);
  const pixels = new Uint32Array(data.buffer, data.byteOffset, width * height);

  for (let top = 0; top < height; top += block) {
    const bottom = Math.min(height, top + block);
    sums.fill(0);
    for (let y = top; y < bottom; y++) {
      let i = y * width * 4;
      let k = 0;
      let within = 0;
      for (let x = 0; x < width; x++, i += 4) {
        sums[k] = sums[k]! + data[i]!;
        sums[k + 1] = sums[k + 1]! + data[i + 1]!;
        sums[k + 2] = sums[k + 2]! + data[i + 2]!;
        sums[k + 3] = sums[k + 3]! + data[i + 3]!;
        if (++within === block) {
          within = 0;
          k += 4;
        }
      }
    }
    for (let b = 0; b < blocks; b++) {
      const left = b * block;
      const right = Math.min(width, left + block);
      const count = (bottom - top) * (right - left);
      // Packing through bytes keeps this independent of the platform's endianness.
      for (let c = 0; c < 4; c++) packedBytes[c] = Math.round(sums[b * 4 + c]! / count);
      const value = packed[0]!;
      for (let y = top; y < bottom; y++) pixels.fill(value, y * width + left, y * width + right);
    }
  }
}

/**
 * Ordered dithering: fewer shades per color the higher `amount` goes, the in-between
 * ones drawn as a Bayer pattern of dots, one pattern cell per `dotSize` pixels.
 */
function dither(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  dotSize: number,
): void {
  // Shades fall fast: past the middle of the slider it is pixel-art few.
  const shades = Math.round(1 + (1 - Math.min(amount, 100) / 100) ** 2 * 15);
  const table = new Uint8ClampedArray(16 * 256);
  for (let t = 0; t < 16; t++) {
    const threshold = (t + 0.5) / 16;
    for (let v = 0; v < 256; v++) {
      const level = Math.floor((v / 255) * shades + threshold);
      table[t * 256 + v] = Math.min(1, level / shades) * 255;
    }
  }

  for (let y = 0; y < height; y++) {
    const bayerRow = (Math.floor(y / dotSize) & 3) * 4;
    let i = y * width * 4;
    let column = 0;
    let within = 0;
    for (let x = 0; x < width; x++, i += 4) {
      const offset = BAYER_4[bayerRow + (column & 3)]! * 256;
      data[i] = table[offset + data[i]!]!;
      data[i + 1] = table[offset + data[i + 1]!]!;
      data[i + 2] = table[offset + data[i + 2]!]!;
      if (++within === dotSize) {
        within = 0;
        column++;
      }
    }
  }
}

/** Darker lines across, like an old TV: a soft wave a few pixels tall. */
function scanlines(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const period = Math.max(2, (width / 1600) * 3);
  const strength = (Math.min(amount, 100) / 100) * 0.55;
  for (let y = 0; y < height; y++) {
    const keep = 1 - (0.5 - 0.5 * Math.cos((y / period) * Math.PI * 2)) * strength;
    if (keep >= 1) continue;
    const end = (y + 1) * width * 4;
    for (let i = y * width * 4; i < end; i += 4) {
      data[i] = data[i]! * keep;
      data[i + 1] = data[i + 1]! * keep;
      data[i + 2] = data[i + 2]! * keep;
    }
  }
}

/** Red and blue pulled apart sideways, like a cheap lens: up to 1.2% of the width. */
function splitColors(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const shift = (Math.min(amount, 100) / 100) * width * 0.012;
  const whole = Math.floor(shift);
  const redMix = shift - whole;
  const blueShift = Math.ceil(shift);
  const blueMix = blueShift - shift;
  const reds = new Uint8ClampedArray(width);
  const blues = new Uint8ClampedArray(width);
  const last = width - 1;

  for (let y = 0; y < height; y++) {
    const start = y * width * 4;
    for (let x = 0, i = start; x < width; x++, i += 4) {
      reds[x] = data[i]!;
      blues[x] = data[i + 2]!;
    }
    for (let x = 0, i = start; x < width; x++, i += 4) {
      const redFrom = Math.min(last, x + whole);
      const redTo = Math.min(last, redFrom + 1);
      const blueFrom = Math.max(0, x - blueShift);
      const blueTo = Math.min(last, blueFrom + 1);
      data[i] = reds[redFrom]! + (reds[redTo]! - reds[redFrom]!) * redMix;
      data[i + 2] = blues[blueFrom]! + (blues[blueTo]! - blues[blueFrom]!) * blueMix;
    }
  }
}

/** Bands of the picture slid sideways (some with red and blue swapped), more and farther the higher `amount`. */
function glitch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  random: () => number,
): void {
  const strength = Math.min(amount, 100) / 100;
  const bands = 4 + Math.floor(strength * 14);
  const original = new Uint8ClampedArray(width * 4);

  for (let band = 0; band < bands; band++) {
    const top = Math.floor(random() * height);
    const thickness = Math.max(
      1,
      Math.floor((0.006 + random() * 0.04) * height * (0.6 + strength)),
    );
    const slide = Math.trunc((random() - 0.5) * 2 * strength * width * 0.09);
    const swap = random() > 0.55;
    // Rows wrap around, so what leaves on one side comes back on the other.
    const offset = (((slide % width) + width) % width) * 4;

    for (let y = top; y < Math.min(height, top + thickness); y++) {
      const row = data.subarray(y * width * 4, (y + 1) * width * 4);
      if (offset > 0) {
        original.set(row);
        row.set(original.subarray(0, row.length - offset), offset);
        row.set(original.subarray(row.length - offset), 0);
      }
      if (swap) {
        for (let i = 0; i < row.length; i += 4) {
          const red = row[i]!;
          row[i] = row[i + 2]!;
          row[i + 2] = red;
        }
      }
    }
  }
}

/** Monochrome film grain: one random brightness shift per `dotSize` square. */
function grain(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  dotSize: number,
  random: () => number,
): void {
  const spread = (Math.min(amount, 100) / 100) * 0.3 * 255 * 2;
  const shifts = new Float32Array(Math.ceil(width / dotSize));

  for (let y = 0; y < height; y++) {
    if (y % dotSize === 0) {
      for (let c = 0; c < shifts.length; c++) shifts[c] = (random() - 0.5) * spread;
    }
    let i = y * width * 4;
    let column = 0;
    let within = 0;
    for (let x = 0; x < width; x++, i += 4) {
      const shift = shifts[column]!;
      data[i] = data[i]! + shift;
      data[i + 1] = data[i + 1]! + shift;
      data[i + 2] = data[i + 2]! + shift;
      if (++within === dotSize) {
        within = 0;
        column++;
      }
    }
  }
}
