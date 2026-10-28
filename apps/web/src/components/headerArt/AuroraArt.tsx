import {
  ArtSvg,
  compactViewBox,
  fillOf,
  PaperGradient,
  round,
  seededRandom,
  stopOf,
  swellPaths,
  useArtIds,
} from "./shared";

interface AuroraRibbon {
  y: number;
  amplitude: number;
  period: number;
  shift: number;
  gradient: "warm" | "cool";
  strength: number;
}

const AURORA_RIBBONS: ReadonlyArray<AuroraRibbon> = [
  { y: 27, amplitude: 9, period: 560, shift: 120, gradient: "cool", strength: 0.55 },
  { y: 44, amplitude: 10, period: 436, shift: 210, gradient: "cool", strength: 0.85 },
  { y: 33, amplitude: 12, period: 344, shift: 40, gradient: "warm", strength: 1 },
];

// The blur is limited to this run, which covers any sidebar a screen can fit, so its offscreen
// surface stays small.
const AURORA_SPAN = 1800;

const AURORA_RIBBON_PATHS = AURORA_RIBBONS.map((ribbon) => ({
  ribbon,
  d: swellPaths(ribbon, AURORA_SPAN).crest,
}));

const AURORA_RAY_FADE = [0.34, 0.24, 0.15, 0.08, 0.03];
const AURORA_RAY_STEP = 4.5;

// Curtains of light hang from the brightest ribbon and fade in steps that the blur smooths out.
function buildAuroraRays() {
  const random = seededRandom(0xa0a);
  const ribbon = AURORA_RIBBONS[2]!;
  const half = ribbon.period / 2;
  const steps = AURORA_RAY_FADE.map((opacity) => ({ opacity, d: "" }));
  for (let x = 14; x < AURORA_SPAN - 40; x += 3.5 + random() * 3) {
    const along = x + ribbon.shift;
    const t = (along % half) / half;
    const swing =
      (Math.floor(along / half) % 2 === 0 ? -1 : 1) * 4 * ribbon.amplitude * t * (1 - t);
    const reach = 1 + Math.floor(random() * AURORA_RAY_FADE.length);
    const width = round(0.6 + random() * 0.8);
    for (let step = 0; step < reach; step += 1) {
      steps[step]!.d +=
        `M${round(x)} ${round(ribbon.y + swing + step * AURORA_RAY_STEP)}h${width}v${AURORA_RAY_STEP}h${-width}z`;
    }
  }
  return steps;
}

const AURORA_RAYS = buildAuroraRays();

export function AuroraArt({ compact = false }: { compact?: boolean }) {
  const id = useArtIds();
  const paperId = id("aurora-paper");
  const warmId = id("aurora-warm");
  const coolId = id("aurora-cool");
  const wideId = id("aurora-wide");
  const softId = id("aurora-soft");
  const crispId = id("aurora-crisp");
  const gradientIds = { warm: warmId, cool: coolId };
  const region = { x: -60, y: -40, width: AURORA_SPAN + 120, height: 176 };

  return (
    <ArtSvg name="aurora" viewBox={compactViewBox(compact, 80)}>
      <defs>
        <PaperGradient id={paperId} />
        <linearGradient
          id={warmId}
          x1="0"
          y1="0"
          x2="420"
          y2="0"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={stopOf("secondary")} />
          <stop offset="0.5" style={stopOf("highlight")} />
          <stop offset="1" style={stopOf("tertiary")} />
        </linearGradient>
        <linearGradient
          id={coolId}
          x1="0"
          y1="0"
          x2="520"
          y2="0"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={stopOf("tertiary")} />
          <stop offset="0.5" style={stopOf("secondary")} />
          <stop offset="1" style={stopOf("highlight")} />
        </linearGradient>
        <filter id={wideId} {...region} filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={softId} {...region} filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id={crispId} {...region} filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      {(
        [
          { filter: wideId, width: 26, opacity: 0.6 },
          { filter: softId, width: 8, opacity: 0.55 },
          { filter: crispId, width: 1.6, opacity: 0.6 },
        ] as const
      ).map((layer) => (
        <g
          key={layer.filter}
          filter={`url(#${layer.filter})`}
          strokeLinecap="round"
          strokeWidth={layer.width}
        >
          {AURORA_RIBBON_PATHS.map(({ ribbon, d }) => (
            <path
              key={ribbon.y}
              d={d}
              stroke={`url(#${gradientIds[ribbon.gradient]})`}
              strokeOpacity={layer.opacity * ribbon.strength}
            />
          ))}
        </g>
      ))}
      <g filter={`url(#${crispId})`}>
        {AURORA_RAYS.map((ray) => (
          <path key={ray.opacity} d={ray.d} style={fillOf("highlight")} fillOpacity={ray.opacity} />
        ))}
      </g>
    </ArtSvg>
  );
}
