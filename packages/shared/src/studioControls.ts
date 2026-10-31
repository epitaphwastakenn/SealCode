import type {
  OrchestrationV2StudioControls,
  OrchestrationV2StudioExcludedPlace,
} from "@t3tools/contracts";

export interface StudioControlsChange {
  readonly allowPlaytests?: boolean | undefined;
  readonly excludePlaces?: ReadonlyArray<OrchestrationV2StudioExcludedPlace> | undefined;
  readonly includePlaces?: ReadonlyArray<string> | undefined;
}

export const normalizeStudioControls = (
  controls: OrchestrationV2StudioControls | null | undefined,
): OrchestrationV2StudioControls | undefined => {
  if (controls === null || controls === undefined) return undefined;
  const excluded = new Map<string, OrchestrationV2StudioExcludedPlace>();
  for (const place of controls.excludedPlaces ?? []) excluded.set(place.placeKey, place);
  const allowPlaytests = controls.allowPlaytests === false ? false : undefined;
  if (allowPlaytests === undefined && excluded.size === 0) return undefined;
  return {
    ...(allowPlaytests === undefined ? {} : { allowPlaytests }),
    ...(excluded.size === 0 ? {} : { excludedPlaces: [...excluded.values()] }),
  };
};

export const playtestsAllowed = (controls: OrchestrationV2StudioControls | null | undefined) =>
  controls?.allowPlaytests !== false;

export const excludedStudioPlaces = (
  controls: OrchestrationV2StudioControls | null | undefined,
): ReadonlyArray<OrchestrationV2StudioExcludedPlace> => controls?.excludedPlaces ?? [];

export const isStudioPlaceExcluded = (
  controls: OrchestrationV2StudioControls | null | undefined,
  placeKey: string,
) => excludedStudioPlaces(controls).some((place) => place.placeKey === placeKey);

export const isStudioRestricted = (controls: OrchestrationV2StudioControls | null | undefined) =>
  normalizeStudioControls(controls) !== undefined;

export const applyStudioControlsChange = (
  current: OrchestrationV2StudioControls | null | undefined,
  change: StudioControlsChange,
): OrchestrationV2StudioControls | undefined => {
  const included = new Set(change.includePlaces ?? []);
  const kept = excludedStudioPlaces(current).filter((place) => !included.has(place.placeKey));
  return normalizeStudioControls({
    allowPlaytests: change.allowPlaytests ?? current?.allowPlaytests,
    excludedPlaces: [...kept, ...(change.excludePlaces ?? [])],
  });
};

export const studioControlsEqual = (
  left: OrchestrationV2StudioControls | null | undefined,
  right: OrchestrationV2StudioControls | null | undefined,
): boolean => {
  const a = normalizeStudioControls(left);
  const b = normalizeStudioControls(right);
  if (playtestsAllowed(a) !== playtestsAllowed(b)) return false;
  const aKeys = excludedStudioPlaces(a).map((place) => place.placeKey);
  const bKeys = new Set(excludedStudioPlaces(b).map((place) => place.placeKey));
  return aKeys.length === bKeys.size && aKeys.every((key) => bKeys.has(key));
};

export const studioControlsField = (
  controls: OrchestrationV2StudioControls | null | undefined,
): { readonly studioControls?: OrchestrationV2StudioControls } => {
  const normalized = normalizeStudioControls(controls);
  return normalized === undefined ? {} : { studioControls: normalized };
};
