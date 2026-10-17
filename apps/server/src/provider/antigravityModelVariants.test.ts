import { describe, expect, it } from "@effect/vitest";
import { ANTIGRAVITY_DEFAULT_MODEL, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import type * as EffectAcpSchema from "effect-acp/compat";

import {
  antigravityBaseSlug,
  antigravityEffortSelection,
  antigravitySessionModels,
  buildAntigravityServerModels,
  groupAntigravityModels,
  regroupCachedAntigravityModels,
  resolveAntigravityModelId,
} from "./antigravityModelVariants.ts";

// A personal account's catalog as Antigravity ACP 1.1.1 reported it. The Pro
// ids do not follow the Flash pattern: its top level is "gemini-pro-agent".
const capturedEntries = [
  { value: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { value: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { value: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
  { value: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
  { value: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
  { value: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
  { value: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  { value: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
];

const summarize = (entries: ReadonlyArray<{ value: string; name: string }>) =>
  groupAntigravityModels(entries).map((family) => ({
    slug: family.slug,
    name: family.name,
    variants: family.variants.map((variant) => [variant.modelId, variant.level]),
  }));

describe("groupAntigravityModels", () => {
  it("makes one model per name and orders its levels low to high", () => {
    expect(summarize(capturedEntries)).toEqual([
      {
        slug: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        variants: [
          ["gemini-3.8-flash-low", "low"],
          ["gemini-3.8-flash-medium", "medium"],
          ["gemini-3.8-flash-high", "high"],
        ],
      },
      {
        slug: "gemini-3.7-flash",
        name: "Gemini 3.7 Flash",
        variants: [
          ["gemini-3.7-flash-low", "low"],
          ["gemini-3.7-flash-medium", "medium"],
          ["gemini-3.7-flash-high", "high"],
        ],
      },
      {
        slug: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        variants: [
          ["gemini-3.1-pro-low", "low"],
          ["gemini-pro-agent", "high"],
        ],
      },
    ]);
  });

  it("groups by slug suffix when the display name carries no level", () => {
    expect(
      summarize([
        { value: "gemini-test-low", name: "Gemini Test Low" },
        { value: "gemini-test-high", name: "Gemini Test High" },
        { value: "gemini-bare-medium", name: "gemini-bare-medium" },
        { value: "gemini-bare-xhigh", name: "gemini-bare-xhigh" },
      ]),
    ).toEqual([
      {
        slug: "gemini-test",
        name: "Gemini Test",
        variants: [
          ["gemini-test-low", "low"],
          ["gemini-test-high", "high"],
        ],
      },
      {
        slug: "gemini-bare",
        name: "gemini-bare",
        variants: [
          ["gemini-bare-medium", "medium"],
          ["gemini-bare-xhigh", "xhigh"],
        ],
      },
    ]);
  });

  it("keeps models without siblings exactly as the account names them", () => {
    const entries = [
      { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
      { value: "gpt-oss-120b", name: "GPT-OSS 120B (Medium)" },
      { value: "gemini-3-flash", name: "Gemini 3 Flash" },
    ];
    expect(summarize(entries)).toEqual(
      entries.map((entry) => ({
        slug: entry.value,
        name: entry.name,
        variants: [[entry.value, undefined]],
      })),
    );
  });

  it("never drops a model: a repeated level or an occupied base id stays its own entry", () => {
    expect(
      summarize([
        { value: "model-a-high", name: "Model A (High)" },
        { value: "model-a-low", name: "Model A (Low)" },
        { value: "model-a-high-v2", name: "Model A (High)" },
        { value: "model-b", name: "Model B" },
        { value: "model-b-high", name: "Model B (High)" },
        { value: "model-b-low", name: "Model B (Low)" },
      ]).map((family) => family.variants.map((variant) => variant[0])),
    ).toEqual([
      ["model-a-low", "model-a-high"],
      ["model-a-high-v2"],
      ["model-b"],
      ["model-b-high"],
      ["model-b-low"],
    ]);
  });

  it("skips blank and duplicate ids and falls back to the id for a blank name", () => {
    expect(
      summarize([
        { value: " ", name: "Blank" },
        { value: "model-x", name: "  " },
        { value: "model-x", name: "Duplicate" },
      ]),
    ).toEqual([{ slug: "model-x", name: "model-x", variants: [["model-x", undefined]] }]);
  });
});

describe("buildAntigravityServerModels", () => {
  const effort = (model: ServerProviderModel | undefined) =>
    model?.capabilities?.optionDescriptors?.[0];

  it("declares a reasoning-effort slider on grouped models only", () => {
    const models = buildAntigravityServerModels(
      [...capturedEntries, { value: "claude-opus-4-6", name: "Claude Opus 4.6 (Thinking)" }],
      { currentValue: "gemini-3.8-flash-medium" },
    );
    expect(models.map((model) => model.slug)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.1-pro",
      "claude-opus-4-6",
    ]);
    expect(effort(models[0])).toEqual({
      id: "reasoningEffort",
      label: "Reasoning effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    });
    expect(models[3]?.capabilities).toEqual(createModelCapabilities({ optionDescriptors: [] }));
  });

  it("defaults the level to the session's own, otherwise the middle one", () => {
    const models = buildAntigravityServerModels(capturedEntries, {
      currentValue: "gemini-3.7-flash-high",
    });
    expect(models.map((model) => effort(model)?.currentValue)).toEqual(["medium", "high", "low"]);
  });

  it("marks only the default model and keeps old per-level ids resolvable as aliases", () => {
    const models = buildAntigravityServerModels(capturedEntries, {
      currentValue: "gemini-3.7-flash-high",
    });
    expect(models.filter((model) => model.isDefault).map((model) => model.slug)).toEqual([
      "gemini-3.7-flash",
    ]);
    expect(models[1]?.aliases).toEqual([
      ANTIGRAVITY_DEFAULT_MODEL,
      "gemini-3.7-flash-low",
      "gemini-3.7-flash-medium",
      "gemini-3.7-flash-high",
    ]);
    expect(models[0]?.aliases).toEqual([
      "gemini-3.8-flash-low",
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-high",
    ]);
  });

  it("prefers the manifest default model and its level over the session's", () => {
    const models = buildAntigravityServerModels(capturedEntries, {
      currentValue: "gemini-3.7-flash-low",
      preferredDefault: "gemini-3.8-flash-high",
    });
    expect(models.filter((model) => model.isDefault).map((model) => model.slug)).toEqual([
      "gemini-3.8-flash",
    ]);
    expect(effort(models[0])?.currentValue).toBe("high");
    expect(effort(models[1])?.currentValue).toBe("low");
  });
});

describe("antigravitySessionModels", () => {
  const config = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "a-high",
    options: [
      { value: "a-high", name: "A (High)" },
      { value: "a-low", name: "A (Low)" },
    ],
  } satisfies EffectAcpSchema.SessionConfigOption;

  it("lists the model select first, then models only the legacy list offers", () => {
    const session = antigravitySessionModels({
      configOptions: [config],
      models: {
        currentModelId: "legacy-current",
        availableModels: [
          { modelId: "a-low", name: "A (Low)" },
          { modelId: "b", name: "B" },
        ],
      },
    });
    expect(session.entries.map((entry) => entry.value)).toEqual(["a-high", "a-low", "a-low", "b"]);
    expect([...session.configIds]).toEqual(["a-high", "a-low"]);
    expect(session.currentValue).toBe("a-high");
  });

  it("reads the legacy list alone when the session has no model select", () => {
    const session = antigravitySessionModels({
      models: { currentModelId: "b", availableModels: [{ modelId: "b", name: "B" }] },
    });
    expect(session.entries).toEqual([{ value: "b", name: "B" }]);
    expect(session.configIds.size).toBe(0);
    expect(session.currentValue).toBe("b");
  });
});

describe("resolveAntigravityModelId", () => {
  const families = groupAntigravityModels([
    ...capturedEntries,
    { value: "claude-opus-4-6", name: "Claude Opus 4.6 (Thinking)" },
  ]);
  const resolve = (input: Omit<Parameters<typeof resolveAntigravityModelId>[0], "families">) =>
    resolveAntigravityModelId({ families, ...input });

  it("maps the base model and the chosen level to the id the session accepts", () => {
    expect(resolve({ model: "gemini-3.8-flash", effort: "low" })).toBe("gemini-3.8-flash-low");
    expect(resolve({ model: "gemini-3.8-flash", effort: "high" })).toBe("gemini-3.8-flash-high");
    expect(resolve({ model: "gemini-3.1-pro", effort: "high" })).toBe("gemini-pro-agent");
  });

  it("falls back to the session's level, then the manifest's, then the middle one", () => {
    expect(resolve({ model: "gemini-3.8-flash", currentValue: "gemini-3.8-flash-high" })).toBe(
      "gemini-3.8-flash-high",
    );
    expect(
      resolve({
        model: "gemini-3.8-flash",
        currentValue: "gemini-3.7-flash-low",
        defaultModel: "gemini-3.8-flash-low",
      }),
    ).toBe("gemini-3.8-flash-low");
    expect(resolve({ model: "gemini-3.8-flash" })).toBe("gemini-3.8-flash-medium");
    expect(resolve({ model: "gemini-3.1-pro" })).toBe("gemini-3.1-pro-low");
  });

  it("keeps a thread created with a per-level id on that level unless a level is chosen", () => {
    expect(resolve({ model: "gemini-3.7-flash-low", currentValue: "gemini-3.7-flash-high" })).toBe(
      "gemini-3.7-flash-low",
    );
    expect(resolve({ model: "gemini-pro-agent" })).toBe("gemini-pro-agent");
    expect(resolve({ model: "gemini-3.7-flash-low", effort: "high" })).toBe(
      "gemini-3.7-flash-high",
    );
  });

  it("ignores a level for a model that has none and rejects unknown models", () => {
    expect(resolve({ model: "claude-opus-4-6", effort: "high" })).toBe("claude-opus-4-6");
    expect(resolve({ model: "gemini-3.8-flash", effort: "xhigh" })).toBe("gemini-3.8-flash-medium");
    expect(resolve({ model: "Gemini 3.8 Flash" })).toBeUndefined();
    expect(resolve({ model: "gemini-3.8-flash[reasoning=high]" })).toBeUndefined();
  });
});

describe("antigravityEffortSelection", () => {
  it("reads only the level the picker shows", () => {
    expect(antigravityEffortSelection([{ id: "reasoningEffort", value: "high" }])).toBe("high");
    expect(antigravityEffortSelection([{ id: "reasoningEffort", value: "Medium" }])).toBe("medium");
    expect(antigravityEffortSelection([{ id: "reasoningEffort", value: "turbo" }])).toBeUndefined();
    expect(antigravityEffortSelection([{ id: "effort", value: "high" }])).toBeUndefined();
    expect(antigravityEffortSelection([{ id: "fastMode", value: true }])).toBeUndefined();
    expect(antigravityEffortSelection(undefined)).toBeUndefined();
  });
});

describe("antigravityBaseSlug", () => {
  it("strips one trailing level so manifest ids line up with grouped slugs", () => {
    expect(antigravityBaseSlug("gemini-3.8-flash-high")).toBe("gemini-3.8-flash");
    expect(antigravityBaseSlug("gemini-3.1-pro-low")).toBe("gemini-3.1-pro");
    expect(antigravityBaseSlug("gemini-pro-agent")).toBe("gemini-pro-agent");
  });
});

describe("regroupCachedAntigravityModels", () => {
  const cached = (slug: string, name: string, extra: Partial<ServerProviderModel> = {}) =>
    ({
      slug,
      name,
      isCustom: false,
      capabilities: createModelCapabilities({ optionDescriptors: [] }),
      ...extra,
    }) satisfies ServerProviderModel;

  it("folds cached per-level models into one without losing the default", () => {
    const regrouped = regroupCachedAntigravityModels([
      cached("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)", {
        isDefault: true,
        aliases: [ANTIGRAVITY_DEFAULT_MODEL],
      }),
      cached("gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"),
      cached("gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"),
    ]);
    expect(regrouped.map((model) => model.slug)).toEqual(["gemini-3.8-flash"]);
    expect(regrouped[0]).toMatchObject({
      name: "Gemini 3.8 Flash",
      isDefault: true,
      aliases: [
        ANTIGRAVITY_DEFAULT_MODEL,
        "gemini-3.8-flash-low",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-high",
      ],
    });
    expect(regrouped[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({
      id: "reasoningEffort",
      currentValue: "high",
    });
  });

  it("leaves already grouped, ungroupable and custom models untouched", () => {
    const grouped = buildAntigravityServerModels(capturedEntries.slice(0, 3), {})[0]!;
    const lone = cached("gpt-oss-120b", "GPT-OSS 120B (Medium)", { isLegacy: true });
    const custom = cached("my-model-high", "my-model-high", { isCustom: true });
    const models = [grouped, lone, custom];
    expect(regroupCachedAntigravityModels(models)).toBe(models);
  });

  it("carries legacy status onto the grouped model and keeps unrelated models", () => {
    const lone = cached("gpt-oss-120b", "GPT-OSS 120B (Medium)");
    const regrouped = regroupCachedAntigravityModels([
      cached("gemini-3.7-flash-high", "Gemini 3.7 Flash (High)", { isLegacy: true }),
      lone,
      cached("gemini-3.7-flash-low", "Gemini 3.7 Flash (Low)", { isLegacy: true }),
    ]);
    expect(regrouped.map((model) => [model.slug, model.isLegacy])).toEqual([
      ["gemini-3.7-flash", true],
      ["gpt-oss-120b", undefined],
    ]);
    expect(regrouped[1]).toBe(lone);
  });
});
