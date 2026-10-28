import {
  ArtSvg,
  type ArtToken,
  compactViewBox,
  fillOf,
  PaperGradient,
  round,
  SoftGlow,
  useArtIds,
} from "./shared";

const DOT_TILE = 768;
const DOT_STEP = 12;

const DOT_GLOWS: ReadonlyArray<{
  x: number;
  y: number;
  reach: number;
  inner: ArtToken;
  outer: ArtToken;
  opacity: number;
}> = [
  { x: 200, y: 14, reach: 116, inner: "highlight", outer: "secondary", opacity: 0.42 },
  { x: 340, y: 46, reach: 110, inner: "secondary", outer: "tertiary", opacity: 0.34 },
  { x: 620, y: 16, reach: 112, inner: "tertiary", outer: "secondary", opacity: 0.32 },
];

const DOT_LEVELS: ReadonlyArray<{ token: ArtToken; opacity: number }> = [
  { token: "line", opacity: 0.22 },
  { token: "secondary", opacity: 0.4 },
  { token: "highlight", opacity: 0.5 },
  { token: "highlight", opacity: 0.7 },
  { token: "highlight", opacity: 0.9 },
];

// Dots swell toward the glows like a halftone, and the distance wraps, so the tile repeats cleanly.
function buildDots() {
  const paths = DOT_LEVELS.map(() => "");
  for (let column = 0; column < DOT_TILE / DOT_STEP; column += 1) {
    for (let row = 0; row < 96 / DOT_STEP; row += 1) {
      const cx = column * DOT_STEP + DOT_STEP / 2;
      const cy = row * DOT_STEP + DOT_STEP / 2;
      let strength = 0;
      for (const glow of DOT_GLOWS) {
        const across = Math.abs(cx - glow.x);
        const dx = Math.min(across, DOT_TILE - across);
        const dy = cy - glow.y;
        strength = Math.max(
          strength,
          Math.exp(-((dx * dx + dy * dy) / (glow.reach * glow.reach)) * 2.4),
        );
      }
      const level = Math.round(strength * (DOT_LEVELS.length - 1));
      const radius = round(0.55 + level * 0.46);
      paths[level] +=
        `M${round(cx - radius)} ${cy}a${radius} ${radius} 0 1 0 ${round(radius * 2)} 0a${radius} ${radius} 0 1 0 ${round(-radius * 2)} 0`;
    }
  }
  return DOT_LEVELS.map((level, index) => ({ ...level, d: paths[index]! }));
}

const DOTS = buildDots();

export function DotsArt({ compact = false }: { compact?: boolean }) {
  const id = useArtIds();
  const paperId = id("dots-paper");
  const glowIds = DOT_GLOWS.map((_, index) => id(`dots-glow-${index}`));
  const tileId = id("dots-tile");

  return (
    <ArtSvg name="dots" viewBox={compactViewBox(compact, 100)}>
      <defs>
        <PaperGradient id={paperId} />
        {DOT_GLOWS.map((glow, index) => (
          <SoftGlow key={glowIds[index]} id={glowIds[index]!} {...glow} />
        ))}
        <pattern id={tileId} width={DOT_TILE} height="96" patternUnits="userSpaceOnUse">
          {DOT_GLOWS.map((glow, index) => (
            <rect
              key={glowIds[index]}
              width={DOT_TILE}
              height="96"
              fill={`url(#${glowIds[index]})`}
            />
          ))}
          {DOTS.map((dots) => (
            <path
              key={`${dots.token}-${dots.opacity}`}
              d={dots.d}
              style={fillOf(dots.token)}
              fillOpacity={dots.opacity}
            />
          ))}
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${tileId})`} />
    </ArtSvg>
  );
}
