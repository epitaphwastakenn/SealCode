import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { AVAILABLE_PROVIDER_OPTIONS, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

describe("provider icons", () => {
  it("defines an icon for every available provider", () => {
    for (const provider of AVAILABLE_PROVIDER_OPTIONS) {
      expect(PROVIDER_ICON_BY_PROVIDER[provider.value]).toBeDefined();
    }
  });

  it("includes the SealCode native providers", () => {
    expect(PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("antigravity")]).toBeDefined();
    expect(PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("commandcode")]).toBeDefined();
  });
});
