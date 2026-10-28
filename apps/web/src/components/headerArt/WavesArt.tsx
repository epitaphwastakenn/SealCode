import {
  ArtSvg,
  type ArtToken,
  compactViewBox,
  fillOf,
  PaperGradient,
  SoftGlow,
  stopOf,
  strokeOf,
  swellPaths,
  useArtIds,
} from "./shared";

interface WaveLayer {
  y: number;
  amplitude: number;
  period: number;
  shift: number;
  fill: ArtToken;
  fillOpacity: number;
  crestOpacity: number;
}

const WAVE_LAYERS: ReadonlyArray<WaveLayer> = [
  {
    y: 17,
    amplitude: 3,
    period: 176,
    shift: 10,
    fill: "tertiary",
    fillOpacity: 0.26,
    crestOpacity: 0.6,
  },
  {
    y: 26,
    amplitude: 4,
    period: 224,
    shift: 100,
    fill: "secondary",
    fillOpacity: 0.28,
    crestOpacity: 0.62,
  },
  {
    y: 35,
    amplitude: 5,
    period: 280,
    shift: 30,
    fill: "bottom",
    fillOpacity: 0.4,
    crestOpacity: 0.6,
  },
  {
    y: 44,
    amplitude: 5.6,
    period: 340,
    shift: 170,
    fill: "bottom",
    fillOpacity: 0.6,
    crestOpacity: 0.5,
  },
  {
    y: 54,
    amplitude: 6.4,
    period: 408,
    shift: 60,
    fill: "bottom",
    fillOpacity: 0.82,
    crestOpacity: 0.38,
  },
];

const WAVES = WAVE_LAYERS.map((layer) => ({ layer, ...swellPaths(layer) }));

const WAVE_SUN = { x: 252, y: 13 };

export function WavesArt({ compact = false }: { compact?: boolean }) {
  const id = useArtIds();
  const paperId = id("waves-paper");
  const skyId = id("waves-sky");
  const sunId = id("waves-sun");

  return (
    <ArtSvg name="waves" viewBox={compactViewBox(compact, 64)}>
      <defs>
        <PaperGradient id={paperId} />
        <SoftGlow
          id={skyId}
          x={WAVE_SUN.x}
          y={WAVE_SUN.y}
          reach={170}
          inner="highlight"
          outer="secondary"
          opacity={0.55}
        />
        <radialGradient
          id={sunId}
          cx={WAVE_SUN.x}
          cy={WAVE_SUN.y}
          r="10"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={stopOf("highlight")} stopOpacity="0.95" />
          <stop offset="0.6" style={stopOf("highlight")} stopOpacity="0.6" />
          <stop offset="1" style={stopOf("highlight")} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${skyId})`} />
      <circle cx={WAVE_SUN.x} cy={WAVE_SUN.y} r="10" fill={`url(#${sunId})`} />
      {WAVES.map(({ layer, crest, body }) => (
        <g key={layer.y}>
          <path d={body} style={fillOf(layer.fill)} fillOpacity={layer.fillOpacity} />
          <path
            d={crest}
            style={strokeOf("highlight")}
            strokeOpacity={layer.crestOpacity}
            strokeWidth="0.9"
          />
        </g>
      ))}
    </ArtSvg>
  );
}
