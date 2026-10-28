import { type ReactNode, useId } from "react";

// Every style paints only with the --stage-art-* tokens, so a theme or a picked color tints all of
// them. Shapes stay in the top 64 units, because the header's lower edge fades into the sidebar.
const STAGE_BACKDROP_VIEW_BOX = "0 0 8192 96";

export type ArtToken = "top" | "mid" | "bottom" | "highlight" | "secondary" | "tertiary" | "line";

export const artVar = (token: ArtToken) => `var(--stage-art-${token})`;
export const fillOf = (token: ArtToken) => ({ fill: artVar(token) });
export const strokeOf = (token: ArtToken) => ({ stroke: artVar(token) });
export const stopOf = (token: ArtToken) => ({ stopColor: artVar(token) });

export const round = (value: number) => Math.round(value * 10) / 10;

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function useArtIds() {
  const prefix = useId().replaceAll(":", "");
  return (name: string) => `${prefix}-stage-${name}`;
}

export function ArtSvg({
  name,
  viewBox,
  children,
}: {
  name: string;
  viewBox: string;
  children: ReactNode;
}) {
  return (
    <svg
      data-stage-art={name}
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export const compactViewBox = (compact: boolean, offset: number) =>
  compact ? `${offset} 0 8192 96` : STAGE_BACKDROP_VIEW_BOX;

/** The diagonal base every style shares: darkest under the wordmark, lighter toward the right. */
export function PaperGradient({ id }: { id: string }) {
  return (
    <linearGradient
      id={id}
      x1="60"
      y1="0"
      x2="220"
      y2="96"
      gradientUnits="userSpaceOnUse"
      spreadMethod="reflect"
    >
      <stop style={stopOf("bottom")} />
      <stop offset="0.5" style={stopOf("mid")} />
      <stop offset="1" style={stopOf("top")} />
    </linearGradient>
  );
}

export function SoftGlow({
  id,
  x,
  y,
  reach,
  inner,
  outer,
  opacity,
}: {
  id: string;
  x: number;
  y: number;
  reach: number;
  inner: ArtToken;
  outer: ArtToken;
  opacity: number;
}) {
  return (
    <radialGradient id={id} cx={x} cy={y} r={reach} gradientUnits="userSpaceOnUse">
      <stop style={stopOf(inner)} stopOpacity={opacity} />
      <stop offset="0.55" style={stopOf(outer)} stopOpacity={opacity * 0.4} />
      <stop offset="1" style={stopOf("bottom")} stopOpacity="0" />
    </radialGradient>
  );
}

export function Sparkle({ x, y, size = 1.6 }: { x: number; y: number; size?: number }) {
  return (
    <path
      d={`M${x - size} ${y}H${x + size}M${x} ${y - size}V${y + size}`}
      style={strokeOf("highlight")}
      strokeLinecap="round"
      strokeOpacity="0.7"
      strokeWidth="0.6"
    />
  );
}

const DEFAULT_SWELL_SPAN = 8192 + 512;

// One quadratic arc followed by smooth reflections (T) is a sine-like swell, and the run is long
// enough to cover the widest sidebar, so no pattern seams show.
export function swellPaths(
  layer: { y: number; amplitude: number; period: number; shift: number },
  span = DEFAULT_SWELL_SPAN,
) {
  const half = layer.period / 2;
  const start = -layer.shift;
  let crest = `M${start} ${layer.y}Q${round(start + layer.period / 4)} ${round(layer.y - 2 * layer.amplitude)} ${round(start + half)} ${layer.y}`;
  const segments = Math.ceil(span / half);
  for (let index = 2; index <= segments; index += 1) {
    crest += `T${round(start + index * half)} ${layer.y}`;
  }
  return { crest, body: `${crest}V96H${start}Z` };
}
