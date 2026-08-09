import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  normalizeHeadlessCliModel,
  parseHeadlessCliModelRows,
  type HeadlessCliProviderDefinition,
} from "./HeadlessCliProvider.ts";

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
  });
});

describe("normalizeHeadlessCliModel", () => {
  it("removes legacy Antigravity effort suffixes before invoking the CLI", () => {
    expect(normalizeHeadlessCliModel("antigravity", "gemini-3.6-flash-high")).toBe(
      "gemini-3.6-flash",
    );
    expect(normalizeHeadlessCliModel("antigravity", "gemini-3.6-flash")).toBe("gemini-3.6-flash");
  });

  it("preserves CommandCode model IDs", () => {
    expect(normalizeHeadlessCliModel("commandcode", "gpt-5.3-codex-high")).toBe(
      "gpt-5.3-codex-high",
    );
  });
});
