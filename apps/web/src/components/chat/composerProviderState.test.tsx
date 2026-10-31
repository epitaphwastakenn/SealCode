import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import { getProviderModelCapabilities } from "../../providerModels";
import {
  getComposerProviderState,
  getComposerReasoningStep,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
  withImplicitFastModeDefault,
} from "./composerProviderState";

const PROVIDER: ProviderDriverKind = ProviderDriverKind.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
  };
}

function booleanDescriptor(
  id: string,
  currentValue?: boolean,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return {
    id,
    label: id,
    type: "boolean",
    ...(typeof currentValue === "boolean" ? { currentValue } : {}),
  };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

const MAX_EFFORT_FRAME_CLASSES = {
  composerFrameClassName: "max-effort-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
} as const;

describe("getComposerProviderState", () => {
  it("uses descriptor defaults for display without dispatching them as overrides", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      modelOptions: undefined,
      planModeEnabled: true,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: undefined,
      ...MAX_EFFORT_FRAME_CLASSES,
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
      planModeEnabled: true,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
      planModeEnabled: true,
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      modelOptions: selections(["effort", "max"], ["thinking", false]),
      planModeEnabled: true,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
    });
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      modelOptions: selections(["agent", "plan"]),
      planModeEnabled: true,
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(selections(["agent", "plan"]));
  });

  it("drops the plan agent from dispatch when legacy plan mode is disabled", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      modelOptions: selections(["agent", "plan"]),
      planModeEnabled: false,
    });

    expect(state.modelOptionsForDispatch).toEqual(selections(["agent", "build"]));
  });

  it("drops the agent descriptor entirely when plan is the only option and plan mode is disabled", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("agent", [{ id: "plan", label: "Plan", isDefault: true }]),
      ]),
      modelOptions: selections(["agent", "plan"]),
      planModeEnabled: false,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("falls back to a surviving agent when plan was the descriptor default and plan mode is disabled", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("agent", [
          { id: "plan", label: "Plan", isDefault: true },
          { id: "research", label: "Research" },
        ]),
      ]),
      modelOptions: undefined,
      planModeEnabled: false,
    });

    expect(state.modelOptionsForDispatch).toBeUndefined();
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      modelOptions: selections(["anything", "value"]),
      planModeEnabled: true,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("preserves explicit options when the selected model is absent from the catalog", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("opencode"),
      model: "opencode/kimi-k3",
      models: [
        {
          slug: "opencode/big-pickle",
          name: "Big Pickle",
          isCustom: false,
          capabilities: {},
        },
      ],
      modelOptions: selections(["variant", "max"], ["agent", "build"]),
      planModeEnabled: false,
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["variant", "max"], ["agent", "build"]),
    );
  });

  it.each(["codex", "claudeAgent", "cursor", "grok"])(
    "does not preserve unknown options for a missing %s model",
    (provider) => {
      const state = getComposerProviderState({
        provider: ProviderDriverKind.make(provider),
        model: "missing-model",
        models: modelWith([]),
        modelOptions: selections(["unknown", "value"]),
        planModeEnabled: true,
      });

      expect(state.modelOptionsForDispatch).toBeUndefined();
    },
  );

  it("preserves explicit options while the catalog is empty", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("opencode"),
      model: "opencode/kimi-k3",
      models: [],
      modelOptions: selections(["variant", "max"], ["agent", "build"]),
      planModeEnabled: false,
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["variant", "max"], ["agent", "build"]),
    );
  });

  it("validates options for a known model selected through a legacy alias", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("claudeAgent"),
      model: "legacy-test-model",
      models: [
        {
          slug: "test-model",
          name: "Test Model",
          aliases: ["legacy-test-model"],
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              selectDescriptor("effort", [
                { id: "low", label: "Low" },
                { id: "high", label: "High", isDefault: true },
              ]),
            ],
          },
        },
      ],
      modelOptions: selections(["effort", "low"], ["unknown", "value"]),
      planModeEnabled: false,
    });

    expect(state.modelOptionsForDispatch).toEqual(selections(["effort", "low"]));
  });

  it("still drops the plan agent when an absent model has a saved plan selection", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("opencode"),
      model: "opencode/kimi-k3",
      models: [],
      modelOptions: selections(["variant", "max"], ["agent", "plan"]),
      planModeEnabled: false,
    });

    expect(state.modelOptionsForDispatch).toEqual(selections(["variant", "max"]));
  });

  it("resumes a retired ultrathink effort on the strongest reasoning level", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "high", label: "High", isDefault: true },
          { id: "max", label: "Max" },
        ]),
      ]),
      modelOptions: selections(["effort", "ultrathink"]),
      planModeEnabled: true,
    });

    expect(state.promptEffort).toBe("max");
    expect(state.modelOptionsForDispatch).toEqual(selections(["effort", "max"]));
  });

  describe("Ultracode toggle", () => {
    const ultracodeModels = modelWith([
      selectDescriptor("effort", [
        { id: "high", label: "High", isDefault: true },
        { id: "xhigh", label: "Extra High" },
        { id: "max", label: "Max" },
      ]),
      booleanDescriptor("ultracode"),
    ]);
    const stateFor = (modelOptions: ReadonlyArray<ProviderOptionSelection>) =>
      getComposerProviderState({
        provider: PROVIDER,
        model: MODEL,
        models: ultracodeModels,
        modelOptions,
        planModeEnabled: true,
      });

    it("opens a saved Ultracode effort as Extra High with the toggle on", () => {
      const state = stateFor(selections(["effort", "ultracode"]));

      expect(state.promptEffort).toBe("xhigh");
      expect(state.modelOptionsForDispatch).toEqual(
        selections(["effort", "xhigh"], ["ultracode", true]),
      );
    });

    it("dispatches the toggle next to any effort level", () => {
      expect(stateFor(selections(["effort", "high"], ["ultracode", true]))).toMatchObject({
        promptEffort: "high",
        modelOptionsForDispatch: selections(["effort", "high"], ["ultracode", true]),
      });
    });

    it("frames the composer for effort max only, whatever the toggle says", () => {
      const frame = "max-effort-frame";
      expect(
        stateFor(selections(["effort", "max"], ["ultracode", false])).composerFrameClassName,
      ).toBe(frame);
      expect(
        stateFor(selections(["effort", "max"], ["ultracode", true])).composerFrameClassName,
      ).toBe(frame);
      expect(
        stateFor(selections(["effort", "xhigh"], ["ultracode", true])).composerFrameClassName,
      ).toBeUndefined();
    });
  });

  it("defaults fastMode to false when the provider reports true but the user has not selected it", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("cursor"),
      model: MODEL,
      models: modelWith([booleanDescriptor("fastMode", true)]),
      modelOptions: undefined,
      planModeEnabled: true,
    });

    expect(state.modelOptionsForDispatch).toEqual(selections(["fastMode", false]));
  });

  it("keeps explicit fastMode true when the user selected Fast", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("cursor"),
      model: MODEL,
      models: modelWith([booleanDescriptor("fastMode", true)]),
      modelOptions: selections(["fastMode", true]),
      planModeEnabled: true,
    });

    expect(state.modelOptionsForDispatch).toEqual(selections(["fastMode", true]));
  });

  it("keeps explicit fastMode false when the user selected Normal", () => {
    const state = getComposerProviderState({
      provider: ProviderDriverKind.make("cursor"),
      model: MODEL,
      models: modelWith([booleanDescriptor("fastMode", true)]),
      modelOptions: selections(["fastMode", false]),
      planModeEnabled: true,
    });

    expect(state.modelOptionsForDispatch).toEqual(selections(["fastMode", false]));
  });
});

describe("withImplicitFastModeDefault", () => {
  it("injects fastMode false only when the model exposes fastMode and no selection exists", () => {
    expect(
      withImplicitFastModeDefault(
        {
          optionDescriptors: [booleanDescriptor("fastMode", true)],
        },
        undefined,
      ),
    ).toEqual(selections(["fastMode", false]));

    expect(
      withImplicitFastModeDefault(
        {
          optionDescriptors: [booleanDescriptor("fastMode", true)],
        },
        selections(["fastMode", true]),
      ),
    ).toEqual(selections(["fastMode", true]));
  });

  it("does not add fastMode when the model does not expose it", () => {
    expect(
      withImplicitFastModeDefault(
        {
          optionDescriptors: [booleanDescriptor("thinking", true)],
        },
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("trait controls fastMode display", () => {
  it("resolves traits fastMode to Normal when the provider defaults to true without a user selection", () => {
    const models = modelWith([booleanDescriptor("fastMode", true)]);
    const provider = ProviderDriverKind.make("cursor");
    const caps = getProviderModelCapabilities(models, MODEL, provider);
    const resolved = withImplicitFastModeDefault(caps, undefined);
    const descriptors = getProviderOptionDescriptors({ caps, selections: resolved });
    const fastMode = descriptors.find((descriptor) => descriptor.id === "fastMode");

    expect(fastMode?.type).toBe("boolean");
    if (fastMode?.type === "boolean") {
      expect(fastMode.currentValue).toBe(false);
    }
  });
});

describe("composer max effort frame", () => {
  it("adds the composer gradient frame when the selected effort is the model's maximum", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium", isDefault: true },
          { id: "high", label: "High" },
        ]),
      ]),
      modelOptions: selections(["effort", "high"]),
      planModeEnabled: true,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
      ...MAX_EFFORT_FRAME_CLASSES,
    });
  });

  it("does not add the composer gradient frame for a non-maximum effort", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium", isDefault: true },
          { id: "high", label: "High" },
        ]),
      ]),
      modelOptions: selections(["effort", "medium"]),
      planModeEnabled: true,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
    });
  });
});

describe("provider traits render guards", () => {
  it("returns null when no thread target is provided", () => {
    const models = modelWith([
      selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
    ]);
    const args = {
      provider: PROVIDER,
      model: MODEL,
      models,
      modelOptions: undefined,
      planModeEnabled: true,
    };

    expect(renderProviderTraitsPicker(args)).toBeNull();
    expect(renderProviderTraitsMenuContent(args)).toBeNull();
  });
});

describe("getComposerReasoningStep", () => {
  const LEVELS = [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ];
  const INSTANCE = ProviderInstanceId.make("codex");
  function step(input: Partial<Parameters<typeof getComposerReasoningStep>[0]>) {
    return getComposerReasoningStep({
      provider: PROVIDER,
      instanceId: INSTANCE,
      model: MODEL,
      models: modelWith([selectDescriptor("reasoningEffort", LEVELS)]),
      modelOptions: undefined,
      planModeEnabled: true,
      direction: 1,
      ...input,
    });
  }

  it("walks the catalog order, wrapping at both ends and keeping the other traits", () => {
    const models = modelWith([
      selectDescriptor("contextWindow", [
        { id: "200k", label: "200k", isDefault: true },
        { id: "1m", label: "1M" },
      ]),
      selectDescriptor("reasoningEffort", LEVELS),
    ]);
    for (const [from, direction, to] of [
      ["low", -1, "high"],
      ["low", 1, "medium"],
      ["high", 1, "low"],
      ["high", -1, "medium"],
    ] as const) {
      expect(
        step({
          models,
          modelOptions: selections(["contextWindow", "1m"], ["reasoningEffort", from]),
          direction,
        }),
        `${from} by ${direction}`,
      ).toStrictEqual({
        modelOptions: selections(["contextWindow", "1m"], ["reasoningEffort", to]),
      });
    }
  });

  it("keeps a provider-default Fast mode off unless the user chose it", () => {
    const cursor = {
      provider: ProviderDriverKind.make("cursor"),
      instanceId: ProviderInstanceId.make("cursor"),
      models: modelWith([
        selectDescriptor("reasoning", LEVELS),
        booleanDescriptor("fastMode", true),
      ]),
    };

    expect(step({ ...cursor, modelOptions: undefined })?.modelOptions).toStrictEqual(
      selections(["reasoning", "high"], ["fastMode", false]),
    );
    expect(
      step({ ...cursor, modelOptions: selections(["fastMode", true]) })?.modelOptions,
    ).toStrictEqual(selections(["reasoning", "high"], ["fastMode", true]));
  });

  it("steps from the provider-reported level for the same instance and model", () => {
    const reported = {
      instanceId: INSTANCE,
      model: MODEL,
      options: selections(["reasoningEffort", "high"]),
    };
    for (const { label, modelOptions, reportedModelSelection, to } of [
      { label: "reported", modelOptions: undefined, reportedModelSelection: reported, to: "low" },
      {
        label: "other instance",
        modelOptions: undefined,
        reportedModelSelection: { ...reported, instanceId: ProviderInstanceId.make("codex-work") },
        to: "high",
      },
      {
        label: "other model",
        modelOptions: undefined,
        reportedModelSelection: { ...reported, model: "other-model" },
        to: "high",
      },
      {
        label: "explicit draft",
        modelOptions: selections(["reasoningEffort", "low"]),
        reportedModelSelection: reported,
        to: "medium",
      },
      {
        // OpenCode reports "default" when no variant was chosen.
        label: "reported value outside the catalog",
        modelOptions: undefined,
        reportedModelSelection: {
          ...reported,
          options: selections(["reasoningEffort", "default"]),
        },
        to: "high",
      },
    ]) {
      expect(step({ modelOptions, reportedModelSelection })?.modelOptions, label).toStrictEqual(
        selections(["reasoningEffort", to]),
      );
    }
  });
});
