import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Antigravity publishes one model per reasoning level ("Gemini 3.8 Flash
 * (High)", "...-medium", "...-low"). The picker shows one entry per real model
 * and a reasoning slider; the pure functions here group the per-level ids into
 * one entry and map a (model, level) selection back to the id the ACP session
 * accepts.
 */

export const ANTIGRAVITY_EFFORT_OPTION_ID = "reasoningEffort";
/**
 * Option ids the session has no config option for. Earlier Antigravity
 * integrations stored the level as "effort" or "reasoning"; the picker shows
 * only `reasoningEffort`, so honoring the stale ids would run a level the
 * slider does not display. They are dropped quietly instead of being reported
 * as unsupported session config.
 */
export const ANTIGRAVITY_MODEL_OPTION_IDS = [ANTIGRAVITY_EFFORT_OPTION_ID, "effort", "reasoning"];

const LEVELS = [
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
  { id: "thinking", label: "Thinking" },
] as const;

export type AntigravityEffortLevel = (typeof LEVELS)[number]["id"];

const LEVEL_WORDS = "minimal|low|medium|high|extra[ -]?high|x-?high|max|thinking";
// Real names: "Gemini 3.8 Flash (High)". The slug carries the level as a
// suffix ("gemini-3.8-flash-high"), except for the top level of Pro, which is
// "gemini-pro-agent", so the name is the primary signal.
const NAME_WITH_LEVEL = new RegExp(`^(.*\\S)\\s*[(\\[]\\s*(${LEVEL_WORDS})\\s*[)\\]]\\s*$`, "i");
const NAME_ENDING_IN_LEVEL = new RegExp(`^(.*\\S)[\\s-]+(?:${LEVEL_WORDS})$`, "i");
const SLUG_WITH_LEVEL = /^(.+)-(minimal|low|medium|high|xhigh|max|thinking)$/i;

function levelFromWord(word: string | undefined): AntigravityEffortLevel | undefined {
  if (word === undefined) return undefined;
  const normalized = word.toLowerCase().replace(/[\s-]/g, "");
  const id = normalized === "extrahigh" ? "xhigh" : normalized;
  return LEVELS.find((level) => level.id === id)?.id;
}

const levelRank = (level: AntigravityEffortLevel): number =>
  LEVELS.findIndex((candidate) => candidate.id === level);

const levelLabel = (level: AntigravityEffortLevel): string =>
  LEVELS.find((candidate) => candidate.id === level)?.label ?? level;

export interface AntigravityModelEntry {
  readonly value: string;
  readonly name: string;
}

export interface AntigravityModelVariant {
  /** The id the ACP session accepts. */
  readonly modelId: string;
  /** Undefined for a model that has no levels. */
  readonly level: AntigravityEffortLevel | undefined;
}

export interface AntigravityModelFamily {
  /** What the picker selects: the shared base id, or the model's own id when it has no levels. */
  readonly slug: string;
  readonly name: string;
  /** Ordered low to high. */
  readonly variants: ReadonlyArray<AntigravityModelVariant>;
}

interface ParsedEntry {
  readonly entry: AntigravityModelEntry;
  readonly index: number;
  readonly level: AntigravityEffortLevel | undefined;
  readonly key: string | undefined;
  readonly baseSlug: string | undefined;
  readonly baseName: string;
}

function parseEntry(entry: AntigravityModelEntry, index: number): ParsedEntry {
  const name = entry.name.trim() ? entry.name : entry.value;
  const fromName = NAME_WITH_LEVEL.exec(name);
  const fromSlug = SLUG_WITH_LEVEL.exec(entry.value);
  const nameLevel = levelFromWord(fromName?.[2]);
  const slugLevel = levelFromWord(fromSlug?.[2]);
  const baseSlug = slugLevel === undefined ? undefined : fromSlug?.[1];
  const baseName =
    nameLevel !== undefined && fromName?.[1] !== undefined
      ? fromName[1]
      : slugLevel === undefined
        ? name
        : name === entry.value
          ? (baseSlug ?? name)
          : (NAME_ENDING_IN_LEVEL.exec(name)?.[1] ?? name);
  return {
    entry,
    index,
    level: nameLevel ?? slugLevel,
    key:
      nameLevel !== undefined && fromName?.[1] !== undefined
        ? `name:${fromName[1].toLowerCase()}`
        : baseSlug === undefined
          ? undefined
          : `slug:${baseSlug}`,
    baseSlug,
    baseName,
  };
}

/**
 * Entries that share a base name (or base slug) and differ only in level become
 * one family. A family needs two distinct levels, so a lone "(Low)" entry stays
 * what it is. Anything that cannot be grouped safely stays a single-variant
 * family, so no model the account offers disappears.
 */
export function groupAntigravityModels(
  entries: ReadonlyArray<AntigravityModelEntry>,
): ReadonlyArray<AntigravityModelFamily> {
  const seen = new Set<string>();
  const parsed: ParsedEntry[] = [];
  for (const entry of entries) {
    if (!entry.value.trim() || seen.has(entry.value)) continue;
    seen.add(entry.value);
    parsed.push(parseEntry(entry, parsed.length));
  }

  const buckets = new Map<string, ParsedEntry[]>();
  for (const item of parsed) {
    if (item.key === undefined) continue;
    const bucket = buckets.get(item.key);
    if (bucket) bucket.push(item);
    else buckets.set(item.key, [item]);
  }

  const takenSlugs = new Set(parsed.map((item) => item.entry.value));
  const slots: Array<{ readonly index: number; readonly family: AntigravityModelFamily }> = [];
  const grouped = new Set<ParsedEntry>();
  for (const bucket of buckets.values()) {
    // A second entry at an already-seen level stays its own model.
    const firstPerLevel = new Map<AntigravityEffortLevel, ParsedEntry>();
    for (const item of bucket) {
      if (item.level !== undefined && !firstPerLevel.has(item.level)) {
        firstPerLevel.set(item.level, item);
      }
    }
    if (firstPerLevel.size < 2) continue;
    const members = [...firstPerLevel.entries()].map(([level, item]) => ({ level, item }));
    const slug = members
      .flatMap(({ item }) => (item.baseSlug === undefined ? [] : [item.baseSlug]))
      .toSorted((left, right) => left.length - right.length)[0];
    // A family must not take over an id the account already offers on its own.
    if (slug === undefined || takenSlugs.has(slug)) continue;
    takenSlugs.add(slug);
    for (const { item } of members) grouped.add(item);
    const byPosition = members.toSorted((left, right) => left.item.index - right.item.index);
    slots.push({
      index: byPosition[0]?.item.index ?? 0,
      family: {
        slug,
        name: byPosition[0]?.item.baseName ?? slug,
        variants: members
          .toSorted((left, right) => levelRank(left.level) - levelRank(right.level))
          .map(({ level, item }) => ({ modelId: item.entry.value, level })),
      },
    });
  }

  for (const item of parsed) {
    if (grouped.has(item)) continue;
    slots.push({
      index: item.index,
      family: {
        slug: item.entry.value,
        name: item.entry.name.trim() ? item.entry.name : item.entry.value,
        variants: [{ modelId: item.entry.value, level: undefined }],
      },
    });
  }
  return slots.toSorted((left, right) => left.index - right.index).map((slot) => slot.family);
}

const hasLevels = (family: AntigravityModelFamily): boolean => family.variants.length > 1;

function findFamily(
  families: ReadonlyArray<AntigravityModelFamily>,
  id: string | undefined,
): AntigravityModelFamily | undefined {
  if (id === undefined) return undefined;
  return (
    families.find((family) => family.variants.some((variant) => variant.modelId === id)) ??
    families.find((family) => family.slug === id)
  );
}

/** The session's own level wins; otherwise the middle level, since Low is rarely what people want. */
function defaultVariant(
  family: AntigravityModelFamily,
  hints: ReadonlyArray<string | undefined>,
): AntigravityModelVariant | undefined {
  for (const hint of hints) {
    const hinted = family.variants.find((variant) => variant.modelId === hint);
    if (hinted) return hinted;
  }
  return family.variants[Math.floor((family.variants.length - 1) / 2)];
}

function effortDescriptor(
  family: AntigravityModelFamily,
  defaultLevel: AntigravityEffortLevel | undefined,
): ProviderOptionDescriptor {
  return {
    id: ANTIGRAVITY_EFFORT_OPTION_ID,
    label: "Reasoning effort",
    type: "select",
    options: family.variants.flatMap((variant) =>
      variant.level === undefined
        ? []
        : [
            {
              id: variant.level,
              label: levelLabel(variant.level),
              ...(variant.level === defaultLevel ? { isDefault: true } : {}),
            },
          ],
    ),
    ...(defaultLevel === undefined ? {} : { currentValue: defaultLevel }),
  };
}

const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

/**
 * One picker entry per family. `preferredDefault` (the manifest's default
 * chat model) outranks the session's current model so the default does not
 * drift to whatever level the account last used.
 */
export function buildAntigravityServerModels(
  entries: ReadonlyArray<AntigravityModelEntry>,
  input: {
    readonly currentValue?: string | undefined;
    readonly preferredDefault?: string | undefined;
  },
): ReadonlyArray<ServerProviderModel> {
  const families = groupAntigravityModels(entries);
  const defaultFamily =
    findFamily(families, input.preferredDefault) ?? findFamily(families, input.currentValue);
  const hints = [input.currentValue, input.preferredDefault];
  return families.map((family): ServerProviderModel => {
    const isDefault = family === defaultFamily;
    const levelled = hasLevels(family);
    const aliases = [
      ...(isDefault ? [ANTIGRAVITY_DEFAULT_MODEL] : []),
      // Threads created before levels were grouped still carry a per-level id.
      ...(levelled ? family.variants.map((variant) => variant.modelId) : []),
    ];
    return {
      slug: family.slug,
      name: family.name,
      isCustom: false,
      ...(isDefault ? { isDefault: true } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
      capabilities: levelled
        ? createModelCapabilities({
            optionDescriptors: [effortDescriptor(family, defaultVariant(family, hints)?.level)],
          })
        : EMPTY_CAPABILITIES,
    };
  });
}

export interface AntigravityConfigSelection {
  readonly model: string;
  readonly level?: { readonly configId: string; readonly value: string };
}

export interface AntigravitySessionModels {
  /** The model select first, then models that only the legacy `models` list offers. */
  readonly entries: ReadonlyArray<AntigravityModelEntry>;
  /** Ids the config selects accept; the rest need `session/set_model`. */
  readonly configIds: ReadonlySet<string>;
  readonly configSelections: ReadonlyMap<string, AntigravityConfigSelection>;
  readonly currentValue: string | undefined;
}

interface SessionModelSetup {
  readonly configOptions?: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined;
  readonly models?: EffectAcpSchema.SessionModelState | null | undefined;
}

const selectEntries = (option: EffectAcpSchema.SessionConfigOption | undefined) =>
  option?.type === "select"
    ? option.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options))
    : [];

/**
 * The session can describe its models twice: a `model` config select and the
 * older `models` list. Reading only one hides whatever the other adds.
 */
export function antigravitySessionModels(setup: SessionModelSetup): AntigravitySessionModels {
  const config = setup.configOptions?.find(
    (option) => option.id === "model" || option.category === "model",
  );
  // ACP 1.4 offers base models and puts the level in its own select. Each pair reads as
  // the per-level id the earlier runtimes listed, so threads keep their ids.
  const levelConfig = setup.configOptions?.find((option) => option.category === "thought_level");
  const levels = selectEntries(levelConfig).filter(
    (level) => levelFromWord(level.value) !== undefined,
  );
  const configSelections = new Map<string, AntigravityConfigSelection>();
  const configEntries = selectEntries(config).flatMap((entry) => {
    if (levelConfig === undefined || levels.length === 0) {
      configSelections.set(entry.value, { model: entry.value });
      return [entry];
    }
    return levels.map((level) => {
      const value = `${entry.value}-${level.value}`;
      configSelections.set(value, {
        model: entry.value,
        level: { configId: levelConfig.id, value: level.value },
      });
      return { value, name: `${entry.name} (${level.name})` };
    });
  });
  const currentLevel =
    levels.length > 0 && levelConfig?.type === "select" ? levelConfig.currentValue : undefined;
  const legacyEntries =
    setup.models?.availableModels.map((model) => ({ value: model.modelId, name: model.name })) ??
    [];
  return {
    entries: [...configEntries, ...legacyEntries].map((entry) => ({
      value: entry.value,
      name: entry.name,
    })),
    configIds: new Set(configSelections.keys()),
    configSelections,
    currentValue:
      config?.type !== "select"
        ? setup.models?.currentModelId
        : currentLevel === undefined
          ? config.currentValue
          : `${config.currentValue}-${currentLevel}`,
  };
}

export function antigravityEffortSelection(
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): AntigravityEffortLevel | undefined {
  const value = options?.find((option) => option.id === ANTIGRAVITY_EFFORT_OPTION_ID)?.value;
  return typeof value === "string" ? levelFromWord(value) : undefined;
}

/**
 * Maps the picker's (model, level) to the id the ACP session accepts. A
 * per-level id from an older thread keeps its own level unless a level is
 * chosen explicitly. Undefined means the account does not offer the model.
 */
export function resolveAntigravityModelId(input: {
  readonly families: ReadonlyArray<AntigravityModelFamily>;
  readonly model: string;
  readonly effort?: AntigravityEffortLevel | undefined;
  readonly currentValue?: string | undefined;
  readonly defaultModel?: string | undefined;
}): string | undefined {
  const family = findFamily(input.families, input.model);
  if (!family) return undefined;
  const chosen =
    input.effort === undefined
      ? undefined
      : family.variants.find((variant) => variant.level === input.effort);
  if (chosen) return chosen.modelId;
  if (family.variants.some((variant) => variant.modelId === input.model)) return input.model;
  return defaultVariant(family, [input.currentValue, input.defaultModel])?.modelId;
}

/** Matches a catalog entry's per-level id to the grouped slug the picker uses. */
export function antigravityBaseSlug(slug: string): string {
  return SLUG_WITH_LEVEL.exec(slug)?.[1] ?? slug;
}

const hasEffortDescriptor = (model: ServerProviderModel): boolean =>
  model.capabilities?.optionDescriptors?.some(
    (descriptor) => descriptor.id === ANTIGRAVITY_EFFORT_OPTION_ID,
  ) === true;

/**
 * Status caches written before grouping hold one model per level. Regrouping
 * them keeps the picker populated until the next session refreshes the list;
 * dropping them would leave it empty, as Antigravity has no static fallback.
 */
export function regroupCachedAntigravityModels(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  const perLevel = models.filter((model) => !model.isCustom && !hasEffortDescriptor(model));
  const regrouped = buildAntigravityServerModels(
    perLevel.map((model) => ({ value: model.slug, name: model.name })),
    { currentValue: perLevel.find((model) => model.isDefault)?.slug },
  ).filter((model) => hasEffortDescriptor(model));
  if (regrouped.length === 0) return models;
  const consumed = new Set(regrouped.flatMap((model) => model.aliases ?? []));
  const legacyIds = new Set(perLevel.filter((model) => model.isLegacy).map((model) => model.slug));
  return [
    ...regrouped.map((model) =>
      model.aliases?.some((alias) => legacyIds.has(alias)) ? { ...model, isLegacy: true } : model,
    ),
    ...models.filter((model) => !consumed.has(model.slug)),
  ];
}
