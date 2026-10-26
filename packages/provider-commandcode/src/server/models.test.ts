import { describe, expect, it } from "@effect/vitest";

import {
  commandCodeModelCapabilities,
  commandCodeModels,
  parseCommandCodeModelCatalog,
  parseCommandCodeModelList,
  parseCommandCodeModelReference,
} from "./models.ts";

// Trimmed from `commandcode --list-models` and the CLI's bundled models.md (v1.17.0).
const LIST_OUTPUT = `Available models  ·  4 models

Open Source

deepseek/deepseek-v4-flash           fast hybrid-attention reasoning (default)
moonshotai/kimi-k3                   long-horizon coding & knowledge work with 1M context

Anthropic

claude-sonnet-5                      best combo of speed & intelligence (recommended)

Meta

meta/muse-spark-1.2-contributor      Muse Spark 1.2 at ~95% off

Pass the full id, or just the short name after the last "/":
cmdc --model moonshotai/kimi-k2.5
cmdc --model kimi-k2.5

Docs:  https://commandcode.ai/docs/reference/cli/models
`;

const REFERENCE = `# Command Code Models

## Open Source

| Id (use EXACTLY this) | Name | Context | Efforts | $/1M in/out | Best for |
|---|---|---|---|---|---|
| \`deepseek/deepseek-v4-flash\` | DeepSeek V4 Flash (latest) | 1M | off, high, max | $0.14/$0.28 | fast |
| \`moonshotai/Kimi-K3\` | Kimi K3 | 1M | — | $3/$15 | long-horizon |
## Anthropic

| Id (use EXACTLY this) | Name | Context | Efforts | $/1M in/out | Best for |
|---|---|---|---|---|---|
| \`claude-sonnet-5\` | Claude Sonnet 5 | 1M | low, medium, high, xhigh, max | $2/$10 | best combo |
`;

describe("parseCommandCodeModelList", () => {
  it("keeps model ids and skips headings, hints, and links", () => {
    expect(parseCommandCodeModelList(LIST_OUTPUT)).toEqual([
      "deepseek/deepseek-v4-flash",
      "moonshotai/kimi-k3",
      "claude-sonnet-5",
      "meta/muse-spark-1.2-contributor",
    ]);
  });

  it("strips terminal styling", () => {
    expect(
      parseCommandCodeModelList(
        "\u001b[1mOpen Source\u001b[22m\n\u001b[36mgpt-5.5\u001b[39m   frontier",
      ),
    ).toEqual(["gpt-5.5"]);
  });
});

describe("commandCodeModelCapabilities", () => {
  const options = (efforts: ReadonlyArray<string>) =>
    commandCodeModelCapabilities(efforts).optionDescriptors?.flatMap((descriptor) =>
      descriptor.type === "select"
        ? descriptor.options.map((option) => `${option.id}${option.isDefault ? "*" : ""}`)
        : [],
    );

  it("never defaults to off when only off and low reasoning exist", () => {
    expect(options(["off", "low"])).toEqual(["off", "low*"]);
  });
});

describe("parseCommandCodeModelReference", () => {
  it("sorts efforts from no reasoning up to max whatever order the catalog uses", () => {
    const reference = parseCommandCodeModelReference(
      "| `a` | A | 1M | max, xhigh, Off, low, minimal, high, medium, none | $1 | x |",
    );
    expect(reference.get("a")?.efforts).toEqual([
      "off",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
});

describe("parseCommandCodeModelCatalog", () => {
  const cache = (fetchedAt: number, data: ReadonlyArray<object>) =>
    JSON.stringify({ cacheVersion: 3, fetchedAt, body: { catalogVersion: "x", data } });

  it("reads the newest cached catalog, including aliases and models without efforts", () => {
    const catalog = parseCommandCodeModelCatalog([
      cache(1, [{ id: "moonshotai/Kimi-K3.1-Pro", name: "Old", reasoningEfforts: ["low"] }]),
      cache(2, [
        {
          id: "moonshotai/Kimi-K3.1-Pro",
          name: "Kimi K3.1 Pro",
          aliases: ["kimi-k3.1-pro"],
          reasoningEfforts: ["max", "low", "high"],
          display: { label: "Kimi K3.1 Pro" },
        },
        { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6", reasoningEfforts: null },
      ]),
      "not json",
    ]);
    expect(catalog.get("moonshotai/kimi-k3.1-pro")).toEqual({
      name: "Kimi K3.1 Pro",
      efforts: ["low", "high", "max"],
    });
    expect(catalog.get("kimi-k3.1-pro")?.name).toBe("Kimi K3.1 Pro");
    expect(catalog.get("moonshotai/kimi-k2.6")?.efforts).toEqual([]);
  });
});

describe("commandCodeModels", () => {
  const models = commandCodeModels(
    parseCommandCodeModelList(LIST_OUTPUT),
    parseCommandCodeModelReference(REFERENCE),
  );
  const efforts = (slug: string) =>
    models
      .find((model) => model.slug === slug)
      ?.capabilities?.optionDescriptors?.flatMap((descriptor) =>
        descriptor.type === "select" ? descriptor.options.map((option) => option.id) : [],
      );

  it("takes names and efforts from the reference regardless of id casing", () => {
    expect(models.find((model) => model.slug === "moonshotai/kimi-k3")?.name).toBe("Kimi K3");
    expect(efforts("claude-sonnet-5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(efforts("deepseek/deepseek-v4-flash")).toEqual(["off", "high", "max"]);
  });

  it("offers no effort picker for a model the reference gives none", () => {
    expect(efforts("moonshotai/kimi-k3")).toEqual([]);
    expect(efforts("meta/muse-spark-1.2-contributor")).toEqual([]);
  });

  it("names an unknown model by its id", () => {
    expect(models.find((model) => model.slug === "meta/muse-spark-1.2-contributor")?.name).toBe(
      "meta/muse-spark-1.2-contributor",
    );
  });

  it("defaults to medium, else high, and never to reasoning off", () => {
    const defaults = (slug: string) =>
      models
        .find((model) => model.slug === slug)
        ?.capabilities?.optionDescriptors?.flatMap((descriptor) =>
          descriptor.type === "select"
            ? descriptor.options.filter((option) => option.isDefault).map((option) => option.id)
            : [],
        );
    expect(defaults("claude-sonnet-5")).toEqual(["medium"]);
    expect(defaults("deepseek/deepseek-v4-flash")).toEqual(["high"]);
  });

  it("falls back to the built-in models when the CLI listed none", () => {
    expect(commandCodeModels([], new Map()).map((model) => model.slug)).toContain(
      "deepseek/deepseek-v4-flash",
    );
  });
});
