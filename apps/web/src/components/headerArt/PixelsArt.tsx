import {
  ArtSvg,
  type ArtToken,
  compactViewBox,
  fillOf,
  PaperGradient,
  round,
  seededRandom,
  SoftGlow,
  strokeOf,
  useArtIds,
} from "./shared";

const PIXEL = 8;
const PIXEL_TILE = 512;

const PIXEL_CLUSTERS: ReadonlyArray<{ x: number; y: number; reach: number }> = [
  { x: 236, y: 20, reach: 120 },
  { x: 376, y: 50, reach: 110 },
  { x: 470, y: 12, reach: 90 },
];

const PIXEL_TONES: ReadonlyArray<{ token: ArtToken; opacity: number; weight: number }> = [
  { token: "top", opacity: 0.26, weight: 0.4 },
  { token: "top", opacity: 0.42, weight: 0.18 },
  { token: "secondary", opacity: 0.34, weight: 0.2 },
  { token: "tertiary", opacity: 0.3, weight: 0.1 },
  { token: "highlight", opacity: 0.5, weight: 0.12 },
];

function buildPixels() {
  const random = seededRandom(0x8b17);
  const paths = PIXEL_TONES.map(() => "");
  for (let column = 0; column < PIXEL_TILE / PIXEL; column += 1) {
    for (let row = 0; row < 12; row += 1) {
      const x = column * PIXEL;
      const y = row * PIXEL;
      let cluster = 0;
      for (const spot of PIXEL_CLUSTERS) {
        const dx = x + PIXEL / 2 - spot.x;
        const dy = y + PIXEL / 2 - spot.y;
        cluster = Math.max(
          cluster,
          Math.exp(-((dx * dx + dy * dy) / (spot.reach * spot.reach)) * 1.6),
        );
      }
      const quiet = x < 136 && y > 6 && y < 54 ? 0.25 : 1;
      if (random() > (0.1 + cluster * 0.62) * quiet) continue;
      let pick = random();
      let tone = 0;
      while (tone < PIXEL_TONES.length - 1 && pick > PIXEL_TONES[tone]!.weight) {
        pick -= PIXEL_TONES[tone]!.weight;
        tone += 1;
      }
      paths[tone] += `M${x} ${y}h${PIXEL}v${PIXEL}h${-PIXEL}z`;
    }
  }
  return PIXEL_TONES.map((tone, index) => ({ ...tone, d: paths[index]! }));
}

const PIXELS = buildPixels();

const VOXELS: ReadonlyArray<{ x: number; y: number; size: number }> = [
  { x: 232, y: 31, size: 10 },
  { x: 350, y: 19, size: 7 },
  { x: 452, y: 43, size: 11 },
];

function voxelFaces({ x, y, size }: { x: number; y: number; size: number }) {
  const wide = round(size * 0.866);
  const half = round(size / 2);
  const point = (dx: number, dy: number) => `${round(x + dx)} ${round(y + dy)}`;
  return {
    top: `M${point(0, -size)}L${point(wide, -half)}L${point(0, 0)}L${point(-wide, -half)}Z`,
    right: `M${point(wide, -half)}L${point(wide, half)}L${point(0, size)}L${point(0, 0)}Z`,
    left: `M${point(-wide, -half)}L${point(0, 0)}L${point(0, size)}L${point(-wide, half)}Z`,
  };
}

const VOXEL_FACES = VOXELS.map((voxel) => ({ key: `${voxel.x}-${voxel.y}`, ...voxelFaces(voxel) }));

export function PixelsArt({ compact = false }: { compact?: boolean }) {
  const id = useArtIds();
  const paperId = id("pixels-paper");
  const glowId = id("pixels-glow");
  const tileId = id("pixels-tile");

  return (
    <ArtSvg name="pixels" viewBox={compactViewBox(compact, 152)}>
      <defs>
        <PaperGradient id={paperId} />
        <SoftGlow
          id={glowId}
          x={240}
          y={18}
          reach={130}
          inner="highlight"
          outer="secondary"
          opacity={0.3}
        />
        <pattern id={tileId} width={PIXEL_TILE} height="96" patternUnits="userSpaceOnUse">
          {PIXELS.map((pixels) => (
            <path
              key={`${pixels.token}-${pixels.opacity}`}
              d={pixels.d}
              style={fillOf(pixels.token)}
              fillOpacity={pixels.opacity}
            />
          ))}
          {VOXEL_FACES.map((faces) => (
            <g key={faces.key} strokeLinejoin="round">
              <path d={faces.top} style={fillOf("highlight")} fillOpacity="0.6" />
              <path d={faces.right} style={fillOf("bottom")} fillOpacity="0.75" />
              <path d={faces.left} style={fillOf("secondary")} fillOpacity="0.5" />
              <path
                d={`${faces.top}${faces.right}${faces.left}`}
                style={strokeOf("line")}
                strokeOpacity="0.5"
                strokeWidth="0.6"
              />
            </g>
          ))}
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${glowId})`} />
      <rect width="100%" height="96" fill={`url(#${tileId})`} />
    </ArtSvg>
  );
}
