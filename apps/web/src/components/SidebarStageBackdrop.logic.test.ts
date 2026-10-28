import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarHeaderArtVariant } from "./SidebarStageBackdrop.logic";

describe("resolveSidebarHeaderArtVariant", () => {
  it("shows the brand art on release builds while the setting is on", () => {
    for (const stageLabel of ["", "Alpha", "Beta"]) {
      expect(
        resolveSidebarHeaderArtVariant({
          stageLabel,
          environmentIdentificationMode: "artwork",
          headerArtEnabled: true,
        }),
      ).toBe("brand");
      expect(
        resolveSidebarHeaderArtVariant({
          stageLabel,
          environmentIdentificationMode: "artwork",
          headerArtEnabled: false,
        }),
      ).toBeNull();
    }
  });

  it("keeps the identification mode in charge on Dev and Nightly", () => {
    expect(
      resolveSidebarHeaderArtVariant({
        stageLabel: "Dev",
        environmentIdentificationMode: "artwork",
        headerArtEnabled: false,
      }),
    ).toBe("dev");
    expect(
      resolveSidebarHeaderArtVariant({
        stageLabel: " nightly ",
        environmentIdentificationMode: "artwork",
        headerArtEnabled: false,
      }),
    ).toBe("nightly");
    for (const environmentIdentificationMode of ["pill", "none"] as const) {
      expect(
        resolveSidebarHeaderArtVariant({
          stageLabel: "Dev",
          environmentIdentificationMode,
          headerArtEnabled: true,
        }),
      ).toBeNull();
    }
  });
});
