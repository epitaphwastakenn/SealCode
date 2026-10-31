import type { StudioRole } from "./protocol.ts";

/** What routing needs to know about a connected peer. */
export interface RoutablePeer {
  readonly instanceId: string;
  readonly role: StudioRole;
  readonly placeId: number;
  readonly placeName: string;
  readonly isRunning: boolean;
}

export type RoutingErrorCode =
  | "no_studio_connected"
  | "unrecognized_instance_id"
  | "multiple_instances_connected"
  | "place_excluded"
  | "ambiguous_target"
  | "target_role_required"
  | "target_role_not_present_on_instance";

export interface ConnectedInstanceSummary {
  readonly instance_id: string;
  readonly role: string;
  readonly place_id: number;
  readonly place_name: string;
  readonly running: boolean;
}

export type RouteResult =
  | { readonly _tag: "Routed"; readonly instanceId: string; readonly role: StudioRole }
  | {
      readonly _tag: "RoutingFailed";
      readonly code: RoutingErrorCode;
      readonly message: string;
      readonly instances: ReadonlyArray<ConnectedInstanceSummary>;
    };

export const summarizePeers = (
  peers: ReadonlyArray<RoutablePeer>,
): ReadonlyArray<ConnectedInstanceSummary> =>
  peers.map((peer) => ({
    instance_id: peer.instanceId,
    role: peer.role,
    place_id: peer.placeId,
    place_name: peer.placeName,
    running: peer.isRunning,
  }));

const numericPlaceId = (instanceId: string): number | undefined => {
  const match = /^place:(\d+)$/.exec(instanceId);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/** Peers of the same place, matching through aliases and the numeric place id. */
export const peersOfPlace = (
  peers: ReadonlyArray<RoutablePeer>,
  instanceId: string,
  resolveAlias: (id: string) => string,
): ReadonlyArray<RoutablePeer> => {
  const canonical = resolveAlias(instanceId);
  const numeric = numericPlaceId(canonical);
  return peers.filter(
    (peer) =>
      peer.instanceId === canonical ||
      resolveAlias(peer.instanceId) === canonical ||
      (numeric !== undefined && peer.placeId === numeric),
  );
};

/** One key per place: published ids collapse with the anon id they were published from. */
export const placeKey = (peer: RoutablePeer): string =>
  peer.placeId > 0 ? `place:${peer.placeId}` : peer.instanceId;

const clientNumber = (role: string): number => {
  const match = /^client-(\d+)$/.exec(role);
  return match?.[1] === undefined ? Number.POSITIVE_INFINITY : Number(match[1]);
};

/** Lowest client first (numerically: client-2 before client-10), then edit. */
export const preferRuntimeClient = (peers: ReadonlyArray<RoutablePeer>): RoutablePeer | undefined =>
  peers
    .filter((peer) => peer.role.startsWith("client-"))
    .toSorted((left, right) => clientNumber(left.role) - clientNumber(right.role))[0] ??
  peers.find((peer) => peer.role === "edit");

/**
 * Resolves a tool call's optional `instance_id` and `target` to one peer. Every failure lists the
 * connected peers so the agent can pick one without another call.
 */
export const resolveTarget = (input: {
  readonly peers: ReadonlyArray<RoutablePeer>;
  readonly resolveAlias: (id: string) => string;
  readonly instanceId?: string | undefined;
  readonly target?: string | undefined;
  /** Used when no target is named and the place has several roles. */
  readonly defaultRole?: StudioRole | undefined;
}): RouteResult => {
  const { peers, resolveAlias } = input;
  const instances = summarizePeers(peers);
  const fail = (code: RoutingErrorCode, message: string): RouteResult => ({
    _tag: "RoutingFailed",
    code,
    message,
    instances,
  });
  if (peers.length === 0) {
    return fail(
      "no_studio_connected",
      "No Roblox Studio is connected to Harp. Open the place in Studio and check the Harp panel there.",
    );
  }

  let candidates: ReadonlyArray<RoutablePeer>;
  const requested = input.instanceId?.trim();
  if (requested) {
    candidates = peersOfPlace(peers, requested, resolveAlias);
    if (candidates.length === 0) {
      return fail("unrecognized_instance_id", `No connected Studio place matches ${requested}.`);
    }
  } else {
    const places = new Set(peers.map(placeKey));
    if (places.size > 1) {
      return fail(
        input.target ? "ambiguous_target" : "multiple_instances_connected",
        "Several Studio places are connected; pass instance_id to choose one.",
      );
    }
    candidates = peers;
  }

  const target = input.target?.trim();
  if (target) {
    const match = candidates.find((peer) => peer.role === target);
    if (match === undefined) {
      const roles = [...new Set(candidates.map((peer) => peer.role))].join(", ");
      return fail(
        "target_role_not_present_on_instance",
        `This place has no ${target} peer (connected: ${roles}).${target === "server" || target.startsWith("client-") ? " Start a playtest first." : ""}`,
      );
    }
    return { _tag: "Routed", instanceId: match.instanceId, role: match.role };
  }
  if (candidates.length === 1) {
    const only = candidates[0]!;
    return { _tag: "Routed", instanceId: only.instanceId, role: only.role };
  }
  const preferred =
    candidates.find((peer) => peer.role === (input.defaultRole ?? "edit")) ??
    candidates.find((peer) => peer.role === "edit");
  if (preferred !== undefined) {
    return { _tag: "Routed", instanceId: preferred.instanceId, role: preferred.role };
  }
  return fail("target_role_required", "Several peers are connected for this place; pass target.");
};
