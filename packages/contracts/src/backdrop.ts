import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

/**
 * Harp's window backdrop: an image or GIF behind the app's glass, with the
 * look SealScreen offers (framing, pixel effects, a fade into a color, a
 * vignette and a mouse drift). The image bytes stay on the device; settings
 * only carry the key they are stored under.
 */

const int = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const withDefault = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const BACKDROP_PERCENT_RANGE = { min: 0, max: 100 } as const;
export const BACKDROP_BLUR_RANGE = { min: 0, max: 40 } as const;
export const BACKDROP_ZOOM_RANGE = { min: 100, max: 250 } as const;
export const BACKDROP_PIXEL_RANGE = { min: 1, max: 12 } as const;
export const BACKDROP_SATURATION_RANGE = { min: 0, max: 200 } as const;
export const BACKDROP_BRIGHTNESS_RANGE = { min: 50, max: 150 } as const;
export const BACKDROP_FADE_SIZE_RANGE = { min: 10, max: 100 } as const;
export const BACKDROP_ANGLE_RANGE = { min: 0, max: 360 } as const;

const Percent = int(BACKDROP_PERCENT_RANGE.min, BACKDROP_PERCENT_RANGE.max);

export const BackdropFadeSide = Schema.Literals(["none", "top", "right", "bottom", "left"]);
export type BackdropFadeSide = typeof BackdropFadeSide.Type;

/** `null` fades into the image's own edge color, "theme" into the theme background. */
export const BackdropFadeColor = Schema.NullOr(TrimmedNonEmptyString);
export type BackdropFadeColor = typeof BackdropFadeColor.Type;

/** Everything about how the image looks, apart from which image and its framing. */
export const BackdropLook = Schema.Struct({
  strength: withDefault(Percent, 100),
  blur: withDefault(int(BACKDROP_BLUR_RANGE.min, BACKDROP_BLUR_RANGE.max), 0),
  pixel: withDefault(int(BACKDROP_PIXEL_RANGE.min, BACKDROP_PIXEL_RANGE.max), 1),
  dither: withDefault(Percent, 0),
  grain: withDefault(Percent, 0),
  saturation: withDefault(int(BACKDROP_SATURATION_RANGE.min, BACKDROP_SATURATION_RANGE.max), 100),
  brightness: withDefault(int(BACKDROP_BRIGHTNESS_RANGE.min, BACKDROP_BRIGHTNESS_RANGE.max), 100),
  duotone: withDefault(Percent, 0),
  halftone: withDefault(Percent, 0),
  scanlines: withDefault(Percent, 0),
  posterize: withDefault(Percent, 0),
  chroma: withDefault(Percent, 0),
  glitch: withDefault(Percent, 0),
  edges: withDefault(Percent, 0),
  bloom: withDefault(Percent, 0),
  hue: withDefault(Percent, 0),
  invert: withDefault(Percent, 0),
  vignette: withDefault(Percent, 0),
  fade: withDefault(BackdropFadeSide, "none"),
  fadeAngle: withDefault(
    Schema.NullOr(int(BACKDROP_ANGLE_RANGE.min, BACKDROP_ANGLE_RANGE.max)),
    null,
  ),
  fadeSize: withDefault(int(BACKDROP_FADE_SIZE_RANGE.min, BACKDROP_FADE_SIZE_RANGE.max), 45),
  fadeColor: withDefault(BackdropFadeColor, null),
  parallax: withDefault(Schema.Boolean, false),
  parallaxAmount: withDefault(Percent, 40),
});
export type BackdropLook = typeof BackdropLook.Type;

export const AppBackdrop = Schema.Struct({
  ...BackdropLook.fields,
  /** Key of the image in the device's backdrop store. */
  imageId: TrimmedNonEmptyString,
  imageName: withDefault(TrimmedString, ""),
  /** GIFs and animated WebP keep animating, so only CSS-level effects apply to them. */
  animated: withDefault(Schema.Boolean, false),
  x: withDefault(Percent, 50),
  y: withDefault(Percent, 50),
  zoom: withDefault(int(BACKDROP_ZOOM_RANGE.min, BACKDROP_ZOOM_RANGE.max), 100),
  /** Name of the saved style this look came from, if any. */
  style: withDefault(Schema.NullOr(TrimmedNonEmptyString), null),
});
export type AppBackdrop = typeof AppBackdrop.Type;

export const BackdropStyle = Schema.Struct({
  name: TrimmedNonEmptyString,
  look: BackdropLook,
});
export type BackdropStyle = typeof BackdropStyle.Type;

export const MAX_BACKDROP_STYLES = 24;

export const DEFAULT_BACKDROP_LOOK: BackdropLook = {
  strength: 100,
  blur: 0,
  pixel: 1,
  dither: 0,
  grain: 0,
  saturation: 100,
  brightness: 100,
  duotone: 0,
  halftone: 0,
  scanlines: 0,
  posterize: 0,
  chroma: 0,
  glitch: 0,
  edges: 0,
  bloom: 0,
  hue: 0,
  invert: 0,
  vignette: 0,
  fade: "none",
  fadeAngle: null,
  fadeSize: 45,
  fadeColor: null,
  parallax: false,
  parallaxAmount: 40,
};

export function newAppBackdrop(input: {
  readonly imageId: string;
  readonly imageName: string;
  readonly animated: boolean;
}): AppBackdrop {
  return {
    ...DEFAULT_BACKDROP_LOOK,
    imageId: input.imageId,
    imageName: input.imageName,
    animated: input.animated,
    x: 50,
    y: 50,
    zoom: 100,
    style: null,
  };
}

/** The look part of a backdrop, without its image and framing. */
export function backdropLook(backdrop: AppBackdrop): BackdropLook {
  const {
    imageId: _imageId,
    imageName: _imageName,
    animated: _animated,
    x: _x,
    y: _y,
    zoom: _zoom,
    style: _style,
    ...look
  } = backdrop;
  return look;
}

const LOOK_KEYS = Object.keys(DEFAULT_BACKDROP_LOOK) as ReadonlyArray<keyof BackdropLook>;

export function sameBackdropLook(left: BackdropLook, right: BackdropLook): boolean {
  return LOOK_KEYS.every((key) => left[key] === right[key]);
}

/**
 * The image as it is: every effect off, keeping its strength, blur and drift,
 * which are about how it sits behind the glass rather than how it is styled.
 */
export function clearBackdropEffects(look: BackdropLook): BackdropLook {
  return {
    ...DEFAULT_BACKDROP_LOOK,
    strength: look.strength,
    blur: look.blur,
    parallax: look.parallax,
    parallaxAmount: look.parallaxAmount,
  };
}

/** The angle, in degrees clockwise from the top, the fade melts toward. */
export function backdropFadeDegrees(look: BackdropLook): number | null {
  const side = { none: null, top: 0, right: 90, bottom: 180, left: 270 }[look.fade];
  if (side === null) return null;
  return (look.fadeAngle ?? side) % 360;
}
