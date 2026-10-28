import type { EnvironmentIdentificationMode } from "@t3tools/contracts/settings";

/** `brand` is the blueprint art every release channel can show, tinted by the theme. */
export type SidebarStageBackdropVariant = "nightly" | "dev" | "brand";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  enabled = true,
): SidebarStageBackdropVariant | null {
  if (!enabled) return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

/**
 * Dev and Nightly keep their own artwork and the identification setting that governs it;
 * every other build shows the brand art unless the user turned it off.
 */
export function resolveSidebarHeaderArtVariant(input: {
  stageLabel: string;
  environmentIdentificationMode: EnvironmentIdentificationMode;
  headerArtEnabled: boolean;
}): SidebarStageBackdropVariant | null {
  const stageVariant = resolveSidebarStageBackdropVariant(
    input.stageLabel,
    input.environmentIdentificationMode === "artwork",
  );
  if (stageVariant !== null) return stageVariant;
  if (resolveEnvironmentIdentificationPillLabel(input.stageLabel) !== null) return null;
  return input.headerArtEnabled ? "brand" : null;
}
