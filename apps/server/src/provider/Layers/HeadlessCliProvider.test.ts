import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  headlessCliHealthProbeArgs,
  normalizeHeadlessCliModel,
  parseCommandCodeModelCatalog,
  parseHeadlessCliModelRows,
  type HeadlessCliProviderDefinition,
} from "./HeadlessCliProvider.ts";

describe("headlessCliHealthProbeArgs", () => {
  it("uses Antigravity's non-interactive version command", () => {
    expect(headlessCliHealthProbeArgs("antigravity")).toEqual(["--version"]);
    expect(headlessCliHealthProbeArgs("commandcode")).toEqual(["--no-auto-update", "--version"]);
  });
});

const commandCode: HeadlessCliProviderDefinition = {
  driver: ProviderDriverKind.make("commandcode"),
  displayName: "CommandCode",
  protocol: "commandcode",
  defaultModels: [],
};

const antigravity: HeadlessCliProviderDefinition = {
  driver: ProviderDriverKind.make("antigravity"),
  displayName: "Antigravity",
  protocol: "antigravity",
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

  it("collapses Antigravity effort variants into one model", () => {
    const models = parseHeadlessCliModelRows(
      antigravity,
      [
        "gemini-3.6-flash-high Gemini 3.6 Flash (High)",
        "gemini-3.6-flash-medium Gemini 3.6 Flash (Medium)",
        "gemini-3.6-flash-low Gemini 3.6 Flash (Low)",
      ].join("\n"),
    );

    expect(models.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    ]);
    expect(
      models[0]?.capabilities?.optionDescriptors
        ?.find((descriptor) => descriptor.type === "select")
        ?.options.map(({ id }) => id),
    ).toEqual(["low", "medium", "high"]);
  });

  it("parses the current tab-delimited Antigravity catalog", () => {
    const models = parseHeadlessCliModelRows(
      antigravity,
      [
        "gemini-3.6-flash-high\tGemini 3.6 Flash (High)",
        "gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)",
        "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
        "gemini-3.5-flash-high\tGemini 3.5 Flash (High)",
        "gemini-3.1-pro-low\tGemini 3.1 Pro (Low)",
        "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
      ].join("\n"),
    );

    expect(models.map(({ slug }) => slug)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "claude-sonnet-4-6",
    ]);
    expect(
      models[0]?.capabilities?.optionDescriptors
        ?.find((descriptor) => descriptor.type === "select")
        ?.options.map(({ id }) => id),
    ).toEqual(["low", "medium", "high"]);
  });

  it("parses the Antigravity catalog emitted through Windows ConPTY", () => {
    const models = parseHeadlessCliModelRows(
      antigravity,
      [
        "\u001b[?25l\u001b[2J\u001b[m\u001b[Hâ ‹ Fetching available models...",
        "\u001b[?25h\u001b[?25l\u001b[Hgemini-3.6-flash-high     Gemini 3.6 Flash (High)\u001b[K\r",
        "gemini-3.6-flash-low      Gemini 3.6 Flash (Low)\r",
        "gemini-3.1-pro-low        Gemini 3.1 Pro (Low)\r",
        "\u001b[?25h",
      ].join("\n"),
    );

    expect(models.map(({ slug }) => slug)).toEqual(["gemini-3.6-flash", "gemini-3.1-pro"]);
    expect(
      models[0]?.capabilities?.optionDescriptors
        ?.find((descriptor) => descriptor.type === "select")
        ?.options.map(({ id }) => id),
    ).toEqual(["low", "high"]);
  });

  it("discovers bare and bullet-prefixed Antigravity model rows", () => {
    const models = parseHeadlessCliModelRows(
      antigravity,
      [
        "Available models:",
        "- gemini-3.6-flash",
        "  gemini-3.6-pro Gemini 3.6 Pro",
        "ERROR: logging before google.Init",
        "Fetching available models...",
      ].join("\n"),
    );

    expect(models.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "gemini-3.6-flash", name: "gemini-3.6-flash" },
      { slug: "gemini-3.6-pro", name: "Gemini 3.6 Pro" },
    ]);
  });

  it("discovers Antigravity display-name rows and collapses effort variants", () => {
    const models = parseHeadlessCliModelRows(
      antigravity,
      [
        "\u001b[36m* Gemini 3.6 Flash (Medium)\u001b[0m",
        "* Gemini 3.6 Flash (High)",
        "* Gemini 3.6 Flash (Low)",
        "* Gemini 3.1 Pro (Low)",
        "* Gemini 3.1 Pro (High)",
        "* Claude Sonnet 4.6 (Thinking)",
        "* Qwen 3.7 Flash (High)",
      ].join("\n"),
    );

    expect(models.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "Gemini 3.6 Flash", name: "Gemini 3.6 Flash" },
      { slug: "Gemini 3.1 Pro", name: "Gemini 3.1 Pro" },
      { slug: "Claude Sonnet 4.6", name: "Claude Sonnet 4.6" },
      { slug: "Qwen 3.7 Flash", name: "Qwen 3.7 Flash" },
    ]);
    expect(
      models[0]?.capabilities?.optionDescriptors
        ?.find((descriptor) => descriptor.type === "select")
        ?.options.map(({ id }) => id),
    ).toEqual(["low", "medium", "high"]);
  });
});

describe("normalizeHeadlessCliModel", () => {
  it("removes legacy Antigravity effort suffixes before invoking the CLI", () => {
    expect(normalizeHeadlessCliModel("antigravity", "gemini-3.6-flash-high")).toBe(
      "gemini-3.6-flash",
    );
    expect(normalizeHeadlessCliModel("antigravity", "gemini-3.6-flash")).toBe("gemini-3.6-flash");
    expect(normalizeHeadlessCliModel("antigravity", "Gemini 3.5 Flash (High)")).toBe(
      "Gemini 3.5 Flash",
    );
    expect(normalizeHeadlessCliModel("antigravity", "Claude Sonnet 4.6 (Thinking)")).toBe(
      "Claude Sonnet 4.6",
    );
    expect(normalizeHeadlessCliModel("antigravity", "gemini-3.6-flash-xhigh")).toBe(
      "gemini-3.6-flash",
    );
  });

  it("preserves CommandCode model IDs", () => {
    expect(normalizeHeadlessCliModel("commandcode", "gpt-5.3-codex-high")).toBe(
      "gpt-5.3-codex-high",
    );
  });
});
