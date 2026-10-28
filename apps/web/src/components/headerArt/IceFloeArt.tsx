import {
  ArtSvg,
  type ArtToken,
  compactViewBox,
  fillOf,
  PaperGradient,
  round,
  seededRandom,
  SoftGlow,
  Sparkle,
  strokeOf,
  useArtIds,
} from "./shared";

const ICE_TILE = 640;

interface IceShard {
  x: number;
  y: number;
  size: number;
  turn: number;
  squash: number;
}

const ICE_SHARDS: ReadonlyArray<IceShard> = [
  { x: 28, y: 52, size: 11, turn: 0.4, squash: 0.8 },
  { x: 94, y: 57, size: 14, turn: 1.1, squash: 0.7 },
  { x: 176, y: 36, size: 22, turn: 0.3, squash: 0.85 },
  { x: 238, y: 15, size: 11, turn: 0.9, squash: 0.9 },
  { x: 244, y: 54, size: 16, turn: 0.2, squash: 0.7 },
  { x: 306, y: 31, size: 26, turn: 0.6, squash: 0.78 },
  { x: 372, y: 12, size: 13, turn: 1.4, squash: 0.9 },
  { x: 398, y: 50, size: 21, turn: 0.1, squash: 0.72 },
  { x: 458, y: 24, size: 20, turn: 0.8, squash: 0.85 },
  { x: 512, y: 52, size: 14, turn: 1.2, squash: 0.75 },
  { x: 548, y: 14, size: 10, turn: 0.5, squash: 0.9 },
  { x: 596, y: 38, size: 24, turn: 0.35, squash: 0.8 },
  { x: 140, y: 18, size: 8, turn: 1.0, squash: 0.9 },
  { x: 334, y: 58, size: 9, turn: 0.7, squash: 0.8 },
  { x: 440, y: 56, size: 8, turn: 1.3, squash: 0.85 },
  { x: 622, y: 12, size: 9, turn: 0.2, squash: 0.9 },
];

interface IceFacetGroup {
  key: string;
  token: ArtToken;
  opacity: number;
  d: string;
}

// A shard is a ring of corners fanned from a point nudged toward the light at the upper left, and
// each facet is tinted by how directly it faces that light.
function buildIceFacets() {
  const random = seededRandom(0x1ce);
  const groups = new Map<string, IceFacetGroup>();
  const edges: string[] = [];
  const corners = 6;
  for (const shard of ICE_SHARDS) {
    const ring = Array.from({ length: corners }, (_, index) => {
      const angle = shard.turn + (index / corners) * Math.PI * 2 + (random() - 0.5) * 0.5;
      const reach = shard.size * (0.72 + random() * 0.4);
      return [
        round(shard.x + Math.cos(angle) * reach),
        round(shard.y + Math.sin(angle) * reach * shard.squash),
      ] as const;
    });
    const apex = [
      round(shard.x - shard.size * 0.28),
      round(shard.y - shard.size * 0.3 * shard.squash),
    ] as const;
    ring.forEach((corner, index) => {
      const next = ring[(index + 1) % corners]!;
      const midX = (corner[0] + next[0]) / 2 - apex[0];
      const midY = (corner[1] + next[1]) / 2 - apex[1];
      const facing = -(midX + midY) / (Math.hypot(midX, midY) * Math.SQRT2 || 1);
      const jitter = (random() - 0.5) * 0.3;
      const lit = facing + jitter;
      const [token, opacity] =
        lit > 0.45
          ? (["highlight", 0.34] as const)
          : lit > 0.1
            ? (["highlight", 0.18] as const)
            : lit > -0.3
              ? (["top", 0.2] as const)
              : lit > -0.65
                ? (["bottom", 0.34] as const)
                : (["bottom", 0.55] as const);
      const key = `${token}-${opacity}`;
      const group = groups.get(key) ?? { key, token, opacity, d: "" };
      group.d += `M${apex[0]} ${apex[1]}L${corner[0]} ${corner[1]}L${next[0]} ${next[1]}Z`;
      groups.set(key, group);
      edges.push(`M${apex[0]} ${apex[1]}L${corner[0]} ${corner[1]}L${next[0]} ${next[1]}Z`);
    });
  }
  return { groups: [...groups.values()], edges: edges.join("") };
}

const ICE_FACETS = buildIceFacets();

export function IceFloeArt({ compact = false }: { compact?: boolean }) {
  const id = useArtIds();
  const paperId = id("ice-paper");
  const glowId = id("ice-glow");
  const shardsId = id("ice-shards");

  return (
    <ArtSvg name="iceFloe" viewBox={compactViewBox(compact, 140)}>
      <defs>
        <PaperGradient id={paperId} />
        <SoftGlow
          id={glowId}
          x={236}
          y={20}
          reach={140}
          inner="highlight"
          outer="secondary"
          opacity={0.36}
        />
        <pattern id={shardsId} width={ICE_TILE} height="96" patternUnits="userSpaceOnUse">
          {ICE_FACETS.groups.map((group) => (
            <path
              key={group.key}
              d={group.d}
              style={fillOf(group.token)}
              fillOpacity={group.opacity}
            />
          ))}
          <path
            d={ICE_FACETS.edges}
            style={strokeOf("line")}
            strokeLinejoin="round"
            strokeOpacity="0.28"
            strokeWidth="0.5"
          />
          <Sparkle x={140} y={14} />
          <Sparkle x={338} y={46} size={1.2} />
          <Sparkle x={560} y={30} />
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${glowId})`} />
      <rect width="100%" height="96" fill={`url(#${shardsId})`} />
    </ArtSvg>
  );
}
