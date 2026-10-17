import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  headlessCliHealthProbeArgs,
  parseCommandCodeModelCatalog,
  parseHeadlessCliModelRows,
  type HeadlessCliProviderDefinition,
} from "./HeadlessCliProvider.ts";

describe("headlessCliHealthProbeArgs", () => {
  it("uses CommandCode's non-interactive version command", () => {
    expect(headlessCliHealthProbeArgs("commandcode")).toEqual(["--no-auto-update", "--version"]);
  });
});

const commandCode: HeadlessCliProviderDefinition = {
  driver: ProviderDriverKind.make("commandcode"),
  displayName: "CommandCode",
  protocol: "commandcode",
  defaultModels: [],
};

describe("parseHeadlessCliModelRows", () => {
  it("uses CommandCode model IDs instead of their descriptions", () => {
    const models = parseHeadlessCliModelRows(
      commandCode,
      "gpt-5.3-codex  frontier coding model\ngoogle/gemini-3.6-flash  higher-quality coding",
    );

    expect(models.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "gpt-5.3-codex", name: "gpt-5.3-codex" },
      { slug: "google/gemini-3.6-flash", name: "google/gemini-3.6-flash" },
    ]);
  });

  it("only advertises reasoning effort for models that support it", () => {
    const catalog = parseCommandCodeModelCatalog(
      [
        "| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | 1M | high, max | $0.14/$0.28 |",
        "| `qwen/qwen3.7-flash` | Qwen 3.7 Flash | 1M | — | $0.03/$0.13 |",
        "| `meta/muse-spark-1.1` | Muse Spark 1.1 | 1M | minimal, low, medium, high, xhigh | $1.25/$4.25 |",
      ].join("\n"),
    );
    const models = parseHeadlessCliModelRows(
      commandCode,
      [
        "deepseek/deepseek-v4-flash  fast hybrid-attention reasoning",
        "qwen/qwen3.7-flash  fast low-cost agentic coding & reasoning",
        "meta/muse-spark-1.1  agentic performance, tool use, and computer use",
      ].join("\n"),
      catalog,
    );

    expect(
      models[0]?.capabilities?.optionDescriptors
        ?.find((descriptor) => descriptor.type === "select")
        ?.options.map(({ id }) => id),
    ).toEqual(["high", "max"]);
    expect(models[1]?.capabilities?.optionDescriptors).toHaveLength(0);
    expect(
      models[2]?.capabilities?.optionDescriptors
        ?.find((descriptor) => descriptor.type === "select")
        ?.options.map(({ id }) => id),
    ).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
  });
});
