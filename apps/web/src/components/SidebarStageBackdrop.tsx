import { useAtomValue } from "@effect/atom-react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useEnvironmentIdentificationMode,
} from "../hooks/useSettings";
import { primaryServerConfigAtom } from "../state/server";
import { StageArt } from "./headerArt/StageArt";
import {
  resolveSidebarHeaderArtVariant,
  resolveSidebarStageBackdropVariant,
  type SidebarStageBackdropVariant,
} from "./SidebarStageBackdrop.logic";

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdropVariant(enabled = true): SidebarStageBackdropVariant | null {
  return resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), enabled);
}

/** Waits for hydration like the identification mode, so the art never flashes in and out. */
export function useSidebarHeaderArtVariant(): SidebarStageBackdropVariant | null {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const settingsHydrated = useClientSettingsHydrated();
  const headerArtStyle = useClientSettings((settings) => settings.sidebarHeaderArtStyle);
  return resolveSidebarHeaderArtVariant({
    stageLabel,
    environmentIdentificationMode,
    headerArtStyle: settingsHydrated ? headerArtStyle : "off",
  });
}

export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <StageBackdropArt variant={variant} />
    </div>
  );
}

export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return <StageArt variant={variant} />;
}

export function StageBackdropButtonArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return <StageArt variant={variant} compact />;
}
