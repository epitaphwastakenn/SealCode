import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarHeaderArtVariant } from "./SidebarStageBackdrop.logic";

describe("resolveSidebarHeaderArtVariant", () => {
  it("shows the chosen style on release builds unless it is off", () => {
    for (const stageLabel of ["", "Alpha", "Beta"]) {
      for (const headerArtStyle of ["blueprint", "waves", "aurora"] as const) {
        expect(
          resolveSidebarHeaderArtVariant({
            stageLabel,
            environmentIdentificationMode: "artwork",
            headerArtStyle,
          }),
        ).toBe(headerArtStyle);
      }
      expect(
        resolveSidebarHeaderArtVariant({
          stageLabel,
          environmentIdentificationMode: "artwork",
          headerArtStyle: "off",
        }),
      ).toBeNull();
    }
  });

  it("keeps the identification mode in charge on Dev and Nightly", () => {
    expect(
      resolveSidebarHeaderArtVariant({
        stageLabel: "Dev",
        environmentIdentificationMode: "artwork",
        headerArtStyle: "off",
      }),
    ).toBe("dev");
    expect(
      resolveSidebarHeaderArtVariant({
        stageLabel: " nightly ",
        environmentIdentificationMode: "artwork",
        headerArtStyle: "off",
      }),
    ).toBe("nightly");
    for (const environmentIdentificationMode of ["pill", "none"] as const) {
      expect(
        resolveSidebarHeaderArtVariant({
          stageLabel: "Dev",
          environmentIdentificationMode,
          headerArtStyle: "blueprint",
        }),
      ).toBeNull();
    }
  });
});
