import { describe, expect, it } from "@effect/vitest";

import {
  commandCodeModels,
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
| \`deepseek/deepseek-v4-flash\` | DeepSeek V4 Flash (latest) | 1M | high, max | $0.14/$0.28 | fast |
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
    expect(efforts("deepseek/deepseek-v4-flash")).toEqual(["high", "max"]);
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

  it("marks a medium default only where medium exists", () => {
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
