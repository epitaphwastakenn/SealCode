import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";

import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  buildProviderOptionSelectionsFromDescriptors,
  createModelCapabilities,
  createModelSelection,
  draftModelPickMatchesThread,
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
  migrateLegacyUltracodeOptions,
  migrateLegacyUltracodeSelection,
  readCustomModelEntries,
  normalizeCustomModelSlug,
  normalizeModelSlug,
  modelHasVision,
  modelSelectionsEqual,
  withoutPromptInjectedOptions,
  withUltracodeToggle,
} from "./model.ts";

const codexCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "xhigh", label: "Extra High" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

describe("model slug normalization", () => {
  it("preserves exact custom slugs instead of expanding provider aliases", () => {
    const claude = ProviderDriverKind.make("claudeAgent");

    expect(normalizeModelSlug("opus", claude)).toBe("opus");
    expect(normalizeCustomModelSlug(" opus ")).toBe("opus");
  });
});

const claudeCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "max", label: "Max" },
      ],
      currentValue: "high",
    },
    {
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: [
        { id: "200k", label: "200k" },
        { id: "1m", label: "1M", isDefault: true },
      ],
      currentValue: "1m",
    },
  ],
});

describe("descriptor helpers", () => {
  it("applies selection values to capability descriptors", () => {
    expect(
      getProviderOptionDescriptors({
        caps: claudeCaps,
        selections: [
          { id: "effort", value: "medium" },
          { id: "contextWindow", value: "200k" },
        ],
      }),
    ).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
          { id: "max", label: "Max" },
        ],
        currentValue: "medium",
      },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
        currentValue: "200k",
      },
    ]);
  });

  it("builds dispatch options only from explicit selections", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [{ id: "fastMode", value: true }],
    });

    expect(buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, undefined)).toBe(
      undefined,
    );
    expect(
      buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, [
        { id: "fastMode", value: true },
      ]),
    ).toEqual([{ id: "fastMode", value: true }]);
  });

  it("compares complete model selections independent of option ordering", () => {
    const left = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
    const reordered = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "fastMode", value: true },
      { id: "reasoningEffort", value: "high" },
    ]);

    expect(modelSelectionsEqual(left, reordered)).toBe(true);
    expect(
      modelSelectionsEqual(left, {
        ...reordered,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "medium" },
        ],
      }),
    ).toBe(false);
    expect(modelSelectionsEqual(left, { ...reordered, model: "gpt-5.5" })).toBe(false);
  });
});

describe("retired Ultrathink effort", () => {
  it("resumes saved ultrathink selections on the strongest reasoning level", () => {
    const [effort] = getProviderOptionDescriptors({
      caps: claudeCaps,
      selections: [{ id: "effort", value: "ultrathink" }],
    });
    expect(effort?.currentValue).toBe("max");
  });

  it("drops prompt-injected options from manifest capabilities", () => {
    const caps = createModelCapabilities({
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        },
        { id: "fastMode", label: "Fast Mode", type: "boolean" },
      ],
    });
    expect(withoutPromptInjectedOptions(caps).optionDescriptors).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
      },
      { id: "fastMode", label: "Fast Mode", type: "boolean" },
    ]);
    expect(withoutPromptInjectedOptions(claudeCaps)).toBe(claudeCaps);
  });
});

describe("Ultracode as a toggle next to the effort level", () => {
  const upstreamCaps: ModelCapabilities = createModelCapabilities({
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "high", label: "High", isDefault: true },
          { id: "max", label: "Max" },
          { id: "ultracode", label: "Ultracode" },
        ],
      },
      { id: "fastMode", label: "Fast Mode", type: "boolean" },
    ],
  });
  const toggleCaps = withUltracodeToggle(upstreamCaps);
  const claude = ProviderInstanceId.make("claudeAgent");

  it("turns an upstream Ultracode effort level into a boolean option", () => {
    expect(toggleCaps.optionDescriptors).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "high", label: "High", isDefault: true },
          { id: "max", label: "Max" },
        ],
      },
      { id: "fastMode", label: "Fast Mode", type: "boolean" },
      {
        id: "ultracode",
        label: "Ultracode",
        type: "boolean",
        description: expect.stringContaining("any effort level"),
      },
    ]);
  });

  it("leaves capabilities that already carry the toggle or never had the level", () => {
    expect(withUltracodeToggle(toggleCaps)).toBe(toggleCaps);
    expect(withUltracodeToggle(claudeCaps)).toBe(claudeCaps);
    const both = createModelCapabilities({
      optionDescriptors: [
        ...(upstreamCaps.optionDescriptors ?? []),
        ...(toggleCaps.optionDescriptors ?? []).slice(-1),
      ],
    });
    expect(
      withUltracodeToggle(both).optionDescriptors?.filter((entry) => entry.id === "ultracode"),
    ).toHaveLength(1);
  });

  it("moves saved Ultracode effort selections to Extra High with the toggle on", () => {
    expect(
      migrateLegacyUltracodeOptions([
        { id: "effort", value: "ultracode" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([
      { id: "effort", value: "xhigh" },
      { id: "fastMode", value: true },
      { id: "ultracode", value: true },
    ]);
    expect(migrateLegacyUltracodeOptions([{ id: "effort", value: "high" }])).toEqual([
      { id: "effort", value: "high" },
    ]);
    expect(migrateLegacyUltracodeOptions(undefined)).toBeUndefined();
    expect(migrateLegacyUltracodeOptions(null)).toBeUndefined();
  });

  it("keeps an explicit toggle and returns the same options when nothing is legacy", () => {
    const modern = [
      { id: "effort", value: "high" },
      { id: "ultracode", value: true },
    ];
    expect(migrateLegacyUltracodeOptions(modern)).toBe(modern);
    expect(
      migrateLegacyUltracodeOptions([
        { id: "effort", value: "ultracode" },
        { id: "ultracode", value: false },
      ]),
    ).toEqual([
      { id: "effort", value: "xhigh" },
      { id: "ultracode", value: false },
    ]);
    const selection = createModelSelection(claude, "claude-opus-5-5", modern);
    expect(migrateLegacyUltracodeSelection(selection)).toBe(selection);
  });

  it("resolves a legacy selection to the effort level and the toggle in descriptors", () => {
    const withXhigh = createModelCapabilities({
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "high", label: "High", isDefault: true },
            { id: "xhigh", label: "Extra High" },
            { id: "max", label: "Max" },
          ],
        },
        ...(toggleCaps.optionDescriptors ?? []).slice(-1),
      ],
    });
    const [effort, ultracode] = getProviderOptionDescriptors({
      caps: withXhigh,
      selections: [{ id: "effort", value: "ultracode" }],
    });
    expect(effort?.currentValue).toBe("xhigh");
    expect(ultracode?.currentValue).toBe(true);
  });

  it("treats a switched-off toggle as unset when comparing a draft pick to its thread", () => {
    const thread = createModelSelection(claude, "claude-opus-5-5", [
      { id: "effort", value: "high" },
    ]);
    expect(
      draftModelPickMatchesThread(
        createModelSelection(claude, "claude-opus-5-5", [
          { id: "effort", value: "high" },
          { id: "ultracode", value: false },
        ]),
        thread,
      ),
    ).toBe(true);
    expect(
      draftModelPickMatchesThread(
        createModelSelection(claude, "claude-opus-5-5", [
          { id: "effort", value: "high" },
          { id: "ultracode", value: true },
        ]),
        thread,
      ),
    ).toBe(false);
  });

  it("matches a thread saved with the old Ultracode level to the migrated draft pick", () => {
    expect(
      draftModelPickMatchesThread(
        createModelSelection(claude, "claude-opus-5-5", [
          { id: "effort", value: "xhigh" },
          { id: "ultracode", value: true },
        ]),
        createModelSelection(claude, "claude-opus-5-5", [{ id: "effort", value: "ultracode" }]),
      ),
    ).toBe(true);
  });
});

describe("readCustomModelEntries", () => {
  const capabilities: ModelCapabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
        currentValue: "high",
      },
    ],
  };

  it("resolves bare slugs and entries, trimming and deduplicating on slug", () => {
    expect(
      readCustomModelEntries([
        " bare ",
        { slug: "named", name: " Named ", capabilities },
        "bare",
        { slug: "named", name: "Second" },
        "",
        { name: "no slug" },
        42,
      ]),
    ).toEqual([
      { slug: "bare", name: "bare", capabilities: null },
      { slug: "named", name: "Named", capabilities },
    ]);
  });

  it("drops unparseable capabilities but keeps the entry", () => {
    expect(
      readCustomModelEntries([{ slug: "x", capabilities: { optionDescriptors: "nope" } }]),
    ).toEqual([{ slug: "x", name: "x", capabilities: null }]);
    expect(readCustomModelEntries("not a list")).toEqual([]);
  });
});

describe("provider-reported option display", () => {
  const selection = createModelSelection(ProviderInstanceId.make("opencode"), "ling");
  const reported = { ...selection, options: [{ id: "variant", value: "default" }] };
  const descriptor = {
    id: "variant",
    label: "Reasoning",
    type: "select" as const,
    options: [
      { id: "none", label: "None" },
      { id: "thinking", label: "Thinking" },
    ],
  };

  it("shows explicit reports without adding a choice or a dispatch option", () => {
    expect(getProviderOptionCurrentLabel(descriptor, selection, reported)).toBe("Default");
    expect(
      getProviderOptionCurrentLabel(descriptor, selection, {
        ...reported,
        options: [{ id: "variant", value: "thinking" }],
      }),
    ).toBe("Thinking");
    expect(
      getProviderOptionCurrentLabel(
        { ...descriptor, currentValue: "none" },
        { ...selection, options: [{ id: "variant", value: "none" }] },
        reported,
      ),
    ).toBe("None");
    expect(descriptor.options.map((option) => option.id)).toEqual(["none", "thinking"]);
    expect(buildProviderOptionSelectionsFromDescriptors([descriptor])).toBeUndefined();
    expect(getProviderOptionCurrentLabel(descriptor, selection)).toBe("Unknown");
    const effortDescriptor = { ...descriptor, id: "effort", currentValue: "default" };
    expect(getProviderOptionCurrentLabel(effortDescriptor, selection)).toBeUndefined();
    expect(
      getProviderOptionCurrentLabel(effortDescriptor, selection, {
        ...reported,
        model: "other",
        options: [{ id: "effort", value: "default" }],
      }),
    ).toBeUndefined();
    expect(
      getProviderOptionCurrentLabel(effortDescriptor, selection, {
        ...reported,
        options: [{ id: "effort", value: "default" }],
      }),
    ).toBe("Default");
    expect(
      getProviderOptionCurrentLabel({ ...descriptor, currentValue: "thinking" }, selection),
    ).toBe("Unknown");
  });

  it.each([
    { ...selection, model: "other" },
    { ...selection, instanceId: ProviderInstanceId.make("other") },
    { ...selection, options: [{ id: "variant", value: "none" }] },
  ])("ignores reports after changing the model, instance, or option: %j", (selected) => {
    expect(getProviderOptionCurrentLabel(descriptor, selected, reported)).toBe("Unknown");
  });
});

describe("modelHasVision", () => {
  it("believes a catalog that reports vision, whatever the driver", () => {
    expect(modelHasVision({ driverKind: "opencode", capabilities: { vision: true } })).toBe(true);
    expect(modelHasVision({ driverKind: "codex", capabilities: { vision: false } })).toBe(false);
  });

  it("falls back to Codex and Claude when vision is not reported", () => {
    expect(modelHasVision({ driverKind: "codex" })).toBe(true);
    expect(
      modelHasVision({ driverKind: "claudeAgent", capabilities: { optionDescriptors: [] } }),
    ).toBe(true);
    expect(modelHasVision({ driverKind: "opencode" })).toBe(false);
    expect(modelHasVision({ driverKind: "grok", capabilities: null })).toBe(false);
  });
});
