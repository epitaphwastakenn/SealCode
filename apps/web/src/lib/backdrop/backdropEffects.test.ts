import { DEFAULT_BACKDROP_LOOK } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyBackdropEffects,
  edgeColors,
  hasPixelEffects,
  type BackdropPalette,
  type ImageDataLike,
} from "./backdropEffects";

const PALETTE: BackdropPalette = { base: [20, 40, 60], accent: [240, 120, 40] };

/** A gradient with a bright patch and some hard edges, so every effect has something to bite on. */
function sampleImage(width = 64, height = 48): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const patch = x > width / 2 && y > height / 2;
      data[i] = patch ? 250 : Math.round((x / width) * 200) + 20;
      data[i + 1] = patch ? 240 : Math.round((y / height) * 180) + 30;
      data[i + 2] = (x + y) % 17 < 8 ? 200 : 40;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function apply(image: ImageDataLike, change: Partial<typeof DEFAULT_BACKDROP_LOOK>, seed = 7) {
  return applyBackdropEffects(image, { ...DEFAULT_BACKDROP_LOOK, ...change }, PALETTE, seed);
}

describe("applyBackdropEffects", () => {
  it("leaves a neutral look byte for byte unchanged", () => {
    const image = sampleImage();
    const before = image.data.slice();

    expect(hasPixelEffects(DEFAULT_BACKDROP_LOOK)).toBe(false);
    const result = apply(image, {});

    expect(Array.from(result.data)).toEqual(Array.from(before));
    expect(Array.from(image.data)).toEqual(Array.from(before));
  });

  it("ignores the look settings that are done in CSS", () => {
    const image = sampleImage();
    const cssOnly = { strength: 40, blur: 12, vignette: 60, fade: "left", parallax: true } as const;

    expect(hasPixelEffects({ ...DEFAULT_BACKDROP_LOOK, ...cssOnly })).toBe(false);
    expect(Array.from(apply(image, cssOnly).data)).toEqual(Array.from(image.data));
  });

  it.each([
    ["saturation", { saturation: 0 }],
    ["brightness", { brightness: 130 }],
    ["hue", { hue: 33 }],
    ["invert", { invert: 100 }],
    ["duotone", { duotone: 100 }],
    ["posterize", { posterize: 80 }],
    ["edges", { edges: 100 }],
    ["bloom", { bloom: 100 }],
    ["halftone", { halftone: 100 }],
    ["pixel", { pixel: 5 }],
    ["dither", { dither: 70 }],
    ["scanlines", { scanlines: 100 }],
    ["chroma", { chroma: 100 }],
    ["glitch", { glitch: 100 }],
    ["grain", { grain: 100 }],
  ] as const)("%s changes the image", (_name, change) => {
    const image = sampleImage();
    const before = image.data.slice();

    const result = apply(image, change);

    expect(hasPixelEffects({ ...DEFAULT_BACKDROP_LOOK, ...change })).toBe(true);
    expect(result.width).toBe(image.width);
    expect(result.height).toBe(image.height);
    expect(Array.from(result.data)).not.toEqual(Array.from(before));
    expect(Array.from(image.data)).toEqual(Array.from(before));
  });

  it("keeps alpha untouched", () => {
    const result = apply(sampleImage(), {
      saturation: 20,
      invert: 100,
      halftone: 100,
      dither: 90,
      glitch: 100,
      grain: 100,
    });

    for (let i = 3; i < result.data.length; i += 4) expect(result.data[i]).toBe(255);
  });

  it("turns full inversion into the negative", () => {
    const image: ImageDataLike = {
      data: new Uint8ClampedArray([10, 100, 250, 255]),
      width: 1,
      height: 1,
    };

    expect(Array.from(apply(image, { invert: 100 }).data)).toEqual([245, 155, 5, 255]);
  });

  it("gives grain and glitch the same output for the same seed, another for another seed", () => {
    const image = sampleImage();

    for (const change of [{ grain: 80 }, { glitch: 100 }]) {
      const first = Array.from(apply(image, change, 11).data);
      expect(Array.from(apply(image, change, 11).data)).toEqual(first);
      expect(Array.from(apply(image, change, 12).data)).not.toEqual(first);
    }
  });

  it("makes pixel=4 blocks uniform, edge blocks included", () => {
    // 10 x 6 leaves 2-wide and 2-tall partial blocks at the right and bottom.
    const result = apply(sampleImage(10, 6), { pixel: 4 });
    const at = (x: number, y: number) =>
      Array.from(result.data.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));

    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 10; x++) {
        expect(at(x, y)).toEqual(at(Math.floor(x / 4) * 4, Math.floor(y / 4) * 4));
      }
    }
    expect(at(0, 0)).not.toEqual(at(4, 0));
    expect(at(0, 0)).not.toEqual(at(0, 4));
  });

  it("averages each block for pixel", () => {
    const image: ImageDataLike = {
      data: new Uint8ClampedArray([0, 0, 0, 255, 100, 0, 0, 255, 200, 0, 0, 255, 100, 0, 0, 255]),
      width: 2,
      height: 2,
    };

    const result = apply(image, { pixel: 2 });

    for (let p = 0; p < 4; p++)
      expect(Array.from(result.data.slice(p * 4, p * 4 + 4))).toEqual([100, 0, 0, 255]);
  });

  it("draws a duotone between the palette's dark and light ends", () => {
    const image: ImageDataLike = {
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
      width: 2,
      height: 1,
    };

    const result = apply(image, { duotone: 100 });

    // base * 0.65 and accent + (255 - accent) * 0.15
    expect(Array.from(result.data)).toEqual([13, 26, 39, 255, 242, 140, 72, 255]);
  });

  it("reduces the shades of a posterized image", () => {
    const image = sampleImage();
    const distinct = (data: Uint8ClampedArray) =>
      new Set(Array.from(data).filter((_, i) => i % 4 === 0)).size;

    expect(distinct(apply(image, { posterize: 100 }).data)).toBeLessThanOrEqual(2);
    expect(distinct(image.data)).toBeGreaterThan(8);
  });

  it("darkens alternate rows for scanlines", () => {
    const image = sampleImage(16, 8);

    const result = apply(image, { scanlines: 100 });
    const rowSum = (data: Uint8ClampedArray, y: number) => {
      let sum = 0;
      for (let x = 0; x < 16; x++) sum += data[(y * 16 + x) * 4]!;
      return sum;
    };

    expect(rowSum(result.data, 0)).toBe(rowSum(image.data, 0));
    expect(rowSum(result.data, 1)).toBeLessThan(rowSum(image.data, 1));
  });

  it("moves red and blue in opposite directions for chroma", () => {
    // A single white column on black: red slides one way, blue the other, green stays.
    const width = 100;
    const data = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) data[x * 4 + 3] = 255;
    data.set([255, 255, 255], 50 * 4);

    const result = applyBackdropEffects(
      { data, width, height: 1 },
      { ...DEFAULT_BACKDROP_LOOK, chroma: 100 },
      PALETTE,
      1,
    );
    const column = (channel: number) => {
      const values = Array.from({ length: width }, (_, x) => result.data[x * 4 + channel]!);
      return values.indexOf(Math.max(...values));
    };

    expect(column(1)).toBe(50);
    expect(column(0)).toBeLessThan(50);
    expect(column(2)).toBeGreaterThan(50);
  });
});

describe("edgeColors", () => {
  it("averages a strip of about 4% along each edge", () => {
    const size = 100;
    const data = new Uint8ClampedArray(size * size * 4);
    const paint = (
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      color: [number, number, number],
    ) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) data.set([...color, 255], (y * size + x) * 4);
      }
    };
    paint(0, size, 0, size, [100, 100, 100]);
    paint(0, 4, 4, 96, [0, 200, 0]);
    paint(96, size, 4, 96, [200, 200, 0]);
    paint(0, size, 0, 4, [255, 0, 0]);
    paint(0, size, 96, size, [0, 0, 255]);

    const edges = edgeColors({ data, width: size, height: size });

    expect(edges.top).toEqual([255, 0, 0]);
    expect(edges.bottom).toEqual([0, 0, 255]);
    // 4 rows of red, 4 of blue and 92 of green down the left; 92 of yellow on the right.
    expect(edges.left).toEqual([10, 184, 10]);
    expect(edges.right).toEqual([194, 184, 10]);
  });

  it("still returns a color for a one pixel image", () => {
    const edges = edgeColors({ data: new Uint8ClampedArray([9, 8, 7, 255]), width: 1, height: 1 });

    expect(edges).toEqual({
      top: [9, 8, 7],
      right: [9, 8, 7],
      bottom: [9, 8, 7],
      left: [9, 8, 7],
    });
  });
});
