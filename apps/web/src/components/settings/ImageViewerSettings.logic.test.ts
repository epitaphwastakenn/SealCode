import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { filterImageViewerModelOptions, providerCanViewImages } from "./ImageViewerSettings.logic";

const model = (slug: string, vision?: boolean) => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: vision === undefined ? null : { vision },
});
const provider = (driver: string, models: ReadonlyArray<ReturnType<typeof model>>) =>
  ({ driver: ProviderDriverKind.make(driver), models }) as never;

describe("providerCanViewImages", () => {
  it("trusts reported vision and otherwise only Codex and Claude", () => {
    expect(providerCanViewImages(provider("codex", [model("gpt")]))).toBe(true);
    expect(providerCanViewImages(provider("claudeAgent", [model("haiku")]))).toBe(true);
    expect(providerCanViewImages(provider("opencode", [model("local")]))).toBe(false);
    expect(providerCanViewImages(provider("opencode", [model("local"), model("seer", true)]))).toBe(
      true,
    );
    expect(providerCanViewImages(provider("claudeAgent", [model("blind", false)]))).toBe(false);
  });

  it("keeps an image-reading driver whose models have not loaded yet", () => {
    expect(providerCanViewImages(provider("codex", []))).toBe(true);
    expect(providerCanViewImages(provider("opencode", []))).toBe(false);
  });
});

describe("filterImageViewerModelOptions", () => {
  it("drops models that cannot see and keeps custom ones the driver reads", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const entry = {
      instanceId,
      driverKind: ProviderDriverKind.make("codex"),
      models: [model("blind", false), model("sighted")],
    } as unknown as ProviderInstanceEntry;
    const option = (slug: string) => ({ slug, name: slug });

    const filtered = filterImageViewerModelOptions(
      [entry],
      new Map([[instanceId, [option("blind"), option("sighted"), option("custom")]]]),
    );

    expect(filtered.get(instanceId)?.map((candidate) => candidate.slug)).toEqual([
      "sighted",
      "custom",
    ]);
  });
});
