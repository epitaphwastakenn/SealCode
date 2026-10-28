import type {
  EnvironmentIdentificationMode,
  SidebarHeaderArtStyle,
} from "@t3tools/contracts/settings";

/** The styles every release channel can show, tinted by the theme or the picked color. */
export type SidebarArtStyle = Exclude<SidebarHeaderArtStyle, "off">;
export type SidebarStageBackdropVariant = "nightly" | "dev" | SidebarArtStyle;
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
 * every other build shows the chosen style unless the user turned it off.
 */
export function resolveSidebarHeaderArtVariant(input: {
  stageLabel: string;
  environmentIdentificationMode: EnvironmentIdentificationMode;
  headerArtStyle: SidebarHeaderArtStyle;
}): SidebarStageBackdropVariant | null {
  const stageVariant = resolveSidebarStageBackdropVariant(
    input.stageLabel,
    input.environmentIdentificationMode === "artwork",
  );
  if (stageVariant !== null) return stageVariant;
  if (resolveEnvironmentIdentificationPillLabel(input.stageLabel) !== null) return null;
  return input.headerArtStyle === "off" ? null : input.headerArtStyle;
}
