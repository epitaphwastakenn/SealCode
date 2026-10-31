import type { OrchestrationV2StudioControls } from "@t3tools/contracts";

import { errorResult, type StudioToolResult } from "./toolResult.ts";

export const studioControlsMetaKey = "sealcode/studioControls";

export interface StudioExcludedPlace {
  readonly placeKey: string;
  readonly placeName: string;
}

export interface StudioControlsPolicy {
  readonly allowPlaytests: boolean;
  readonly excludedPlaces: ReadonlyArray<StudioExcludedPlace>;
}

export const policyFromControls = (
  controls: OrchestrationV2StudioControls | null | undefined,
): StudioControlsPolicy => ({
  allowPlaytests: controls?.allowPlaytests !== false,
  excludedPlaces: controls?.excludedPlaces ?? [],
});

export const parseStudioControlsMeta = (value: unknown): StudioControlsPolicy | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const excludedPlaces = Array.isArray(record.excludedPlaces)
    ? record.excludedPlaces.flatMap((entry): StudioExcludedPlace[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const place = entry as Record<string, unknown>;
        return typeof place.placeKey === "string" && place.placeKey.length > 0
          ? [
              {
                placeKey: place.placeKey,
                placeName: typeof place.placeName === "string" ? place.placeName : place.placeKey,
              },
            ]
          : [];
      })
    : [];
  return { allowPlaytests: record.allowPlaytests !== false, excludedPlaces };
};

const luauStartsPlaytest =
  /StudioTestService|ExecutePlayModeAsync|ExecuteRunModeAsync|RunService\s*[:.]\s*(?:Run|Pause|Stop)\b/u;

const playtestStarters: Readonly<Record<string, ReadonlyArray<string>>> = {
  playtest: ["start"],
  multiplayer_playtest: ["start", "add_players"],
};

export const playtestsDisabledResult = (): StudioToolResult =>
  errorResult(
    "playtests_disabled",
    "The user turned off playtests for this thread (the Playtests switch in Harp's agent controls). Do not start one or work around it. Verify with reads, edit-mode screenshots and edit-mode Luau, say what stays unverified, or ask the user to turn playtests back on. Stopping or ending a test that is already running is still allowed.",
  );

export const playtestGate = (
  tool: string,
  args: Readonly<Record<string, unknown>>,
  policy: StudioControlsPolicy | undefined,
): StudioToolResult | undefined => {
  if (policy === undefined || policy.allowPlaytests) return undefined;
  const actions = playtestStarters[tool];
  if (actions !== undefined) {
    return typeof args.action === "string" && actions.includes(args.action)
      ? playtestsDisabledResult()
      : undefined;
  }
  if (
    tool === "execute_luau" &&
    typeof args.code === "string" &&
    luauStartsPlaytest.test(args.code)
  ) {
    return playtestsDisabledResult();
  }
  return undefined;
};
