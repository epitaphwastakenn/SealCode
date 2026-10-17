/**
 * `commandcode --list-models` names the ids a user can pass to `--model`. The
 * CLI's bundled `models.md` is the only place that publishes display names and
 * reasoning efforts, and spells ids with different casing, so the two are
 * joined case-insensitively.
 */
import * as NodeUtil from "node:util";

import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import { buildSelectOptionDescriptor } from "@t3tools/provider-core/server/snapshotProbe";

export const COMMAND_CODE_NO_EFFORT_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

/** Shown until the CLI answers, and whenever it cannot list models. */
export const COMMAND_CODE_FALLBACK_MODELS: ReadonlyArray<{
  readonly slug: string;
  readonly name: string;
}> = [
  { slug: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { slug: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { slug: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
];

const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

const modelKey = (slug: string) => slug.trim().toLowerCase();

const effortRank = (effort: string) => {
  const index = EFFORT_ORDER.indexOf(effort);
  return index === -1 ? EFFORT_ORDER.length : index;
};

const effortLabel = (effort: string) =>
  effort === "xhigh" ? "Extra high" : `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;

export interface CommandCodeCatalogEntry {
  readonly name: string;
  readonly efforts: ReadonlyArray<string>;
}

/** Rows of the `| Id | Name | Context | Efforts | Rate | Best for |` tables. */
export function parseCommandCodeModelReference(
  markdown: string,
): ReadonlyMap<string, CommandCodeCatalogEntry> {
  const entries = new Map<string, CommandCodeCatalogEntry>();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const slug = cells[1]?.replace(/^`|`$/g, "");
    const name = cells[2];
    if (!slug || !name || slug === "Id (use EXACTLY this)" || /^-+$/.test(slug)) continue;
    const efforts = (cells[4] ?? "")
      .split(",")
      .map((effort) => effort.trim().toLowerCase())
      .filter((effort) => /^[a-z]+$/.test(effort))
      .toSorted((left, right) => effortRank(left) - effortRank(right));
    entries.set(modelKey(slug), { name, efforts });
  }
  return entries;
}

const MODEL_LINE = /^([a-z0-9][a-z0-9._:/-]*)\s{2,}\S/;

/** Lines of `--list-models` that start with an id; headings and hints never do. */
export function parseCommandCodeModelList(output: string): ReadonlyArray<string> {
  const slugs = new Set<string>();
  for (const line of NodeUtil.stripVTControlCharacters(output).split(/\r?\n/)) {
    const slug = MODEL_LINE.exec(line.trim())?.[1];
    if (slug !== undefined) slugs.add(slug);
  }
  return [...slugs];
}

export function commandCodeModelCapabilities(efforts: ReadonlyArray<string>): ModelCapabilities {
  if (efforts.length === 0) return COMMAND_CODE_NO_EFFORT_CAPABILITIES;
  const defaultEffort = efforts.includes("medium") ? "medium" : efforts[0];
  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: "effort",
        label: "Reasoning",
        options: efforts.map((effort) => ({
          value: effort,
          label: effortLabel(effort),
          ...(effort === defaultEffort ? { isDefault: true } : {}),
        })),
      }),
    ],
  });
}

export function commandCodeModels(
  slugs: ReadonlyArray<string>,
  reference: ReadonlyMap<string, CommandCodeCatalogEntry>,
): ReadonlyArray<ServerProviderModel> {
  const listed = slugs.length > 0 ? slugs : COMMAND_CODE_FALLBACK_MODELS.map((model) => model.slug);
  return listed.map((slug) => {
    const entry = reference.get(modelKey(slug));
    const fallbackName = COMMAND_CODE_FALLBACK_MODELS.find((model) => model.slug === slug)?.name;
    return {
      slug,
      name: entry?.name ?? fallbackName ?? slug,
      isCustom: false,
      capabilities: commandCodeModelCapabilities(entry?.efforts ?? []),
    };
  });
}
