import type { SidebarArtStyle, SidebarStageBackdropVariant } from "../SidebarStageBackdrop.logic";
import { AuroraArt } from "./AuroraArt";
import { BlueprintArt } from "./BlueprintArt";
import { DotsArt } from "./DotsArt";
import { IceFloeArt } from "./IceFloeArt";
import { NightSkyArt } from "./NightSkyArt";
import { PixelsArt } from "./PixelsArt";
import { WavesArt } from "./WavesArt";

export function StageArt({
  variant,
  compact = false,
}: {
  variant: SidebarStageBackdropVariant;
  compact?: boolean;
}) {
  switch (variant) {
    case "nightly":
      return <NightSkyArt compact={compact} />;
    case "dev":
    case "blueprint":
      return <BlueprintArt compact={compact} />;
    case "nightSky":
      return <NightSkyArt compact={compact} tinted />;
    case "waves":
      return <WavesArt compact={compact} />;
    case "iceFloe":
      return <IceFloeArt compact={compact} />;
    case "dots":
      return <DotsArt compact={compact} />;
    case "pixels":
      return <PixelsArt compact={compact} />;
    case "aurora":
      return <AuroraArt compact={compact} />;
  }
}

export const SIDEBAR_ART_STYLE_LABELS: Record<SidebarArtStyle, string> = {
  blueprint: "Blueprint",
  nightSky: "Night sky",
  waves: "Waves",
  iceFloe: "Ice floe",
  dots: "Dots",
  pixels: "Pixels",
  aurora: "Aurora",
};
