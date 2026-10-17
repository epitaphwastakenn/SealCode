import { describe, expect, it } from "vite-plus/test";

import { createModelSelection } from "@t3tools/shared/model";
import { ProviderInstanceId } from "@t3tools/contracts";

import { lowerEffortSelection, resolveHarnessHelperModelSelection } from "./HelperModelRouting.ts";

const parent = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
  { id: "reasoningEffort", value: "high" },
]);

describe("resolveHarnessHelperModelSelection", () => {
  it("uses an explicit purpose-specific selection", () => {
    const configured = createModelSelection(ProviderInstanceId.make("claudeAgent"), "haiku", []);
    expect(resolveHarnessHelperModelSelection({
      textGenerationModelSelection: parent,
      skillCuratorModelSelection: configured,
    }, "skillCurator")).toEqual(configured);
  });

  it("lowers effort only when the provider exposes an available value", () => {
    expect(lowerEffortSelection(parent, ["low"]).options).toEqual([
      { id: "reasoningEffort", value: "low" },
    ]);
    expect(lowerEffortSelection(parent, []).options).toEqual(parent.options);
  });
});
