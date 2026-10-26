/**
 * `commandcode --list-models` names the ids a user can pass to `--model`. Display
 * names and reasoning efforts come from the CLI's cached remote catalog, which
 * knows models newer than the CLI build, and otherwise from its bundled
 * `models.md`. Both spell ids with different casing, so they are joined
 * case-insensitively.
 */
import * as NodeUtil from "node:util";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import { buildSelectOptionDescriptor } from "@t3tools/provider-core/server/snapshotProbe";

// The headless CLI takes no image input, so the image viewer model describes attachments instead.
export const COMMAND_CODE_NO_EFFORT_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
  vision: false,
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

// The catalog lists efforts in no fixed order (DeepSeek sends `off, high, max`),
// and the slider reads left to right, so efforts are sorted here.
const EFFORT_ORDER = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const REASONING_OFF = new Set(["off", "none"]);

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

const normalizeEfforts = (efforts: ReadonlyArray<string>) =>
  efforts
    .map((effort) => effort.trim().toLowerCase())
    .filter((effort) => /^[a-z]+$/.test(effort))
    .toSorted((left, right) => effortRank(left) - effortRank(right));

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
    entries.set(modelKey(slug), { name, efforts: normalizeEfforts((cells[4] ?? "").split(",")) });
  }
  return entries;
}

const CatalogCache = Schema.Struct({
  fetchedAt: Schema.optional(Schema.Number),
  body: Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        aliases: Schema.optional(Schema.Array(Schema.String)),
        reasoningEfforts: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      }),
    ),
  }),
});
const decodeCatalogCache = Schema.decodeUnknownOption(Schema.fromJsonString(CatalogCache));

/** The CLI's `~/.commandcode/cache/model-catalog/v1/catalog-*.json`; the newest file wins. */
export function parseCommandCodeModelCatalog(
  files: ReadonlyArray<string>,
): ReadonlyMap<string, CommandCodeCatalogEntry> {
  const newest = files
    .flatMap((file) => Option.toArray(decodeCatalogCache(file)))
    .toSorted((left, right) => (right.fetchedAt ?? 0) - (left.fetchedAt ?? 0))[0];
  const entries = new Map<string, CommandCodeCatalogEntry>();
  for (const model of newest?.body.data ?? []) {
    const entry = { name: model.name, efforts: normalizeEfforts(model.reasoningEfforts ?? []) };
    for (const slug of [model.id, ...(model.aliases ?? [])]) entries.set(modelKey(slug), entry);
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
  // The catalog names no default. Prefer the middle of the range and never
  // default to turning reasoning off.
  const defaultEffort =
    ["medium", "high"].find((effort) => efforts.includes(effort)) ??
    efforts.find((effort) => !REASONING_OFF.has(effort)) ??
    efforts[0];
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
    vision: false,
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
