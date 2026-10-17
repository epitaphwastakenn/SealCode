import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ResolvedKeybindingsConfig,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ChevronRightIcon, InfoIcon, SearchIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { ReasoningEffortSlider } from "./ReasoningEffortSlider";
import { Kbd } from "../ui/kbd";
import {
  modelPickerLegacySectionKey,
  modelPickerModelKey,
  parseModelPickerLegacySectionKey,
  parseModelPickerModelKey,
} from "./modelPickerKeys";
import { isModelPickerNewModel } from "./modelPickerModelHighlights";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxListVirtualized,
} from "../ui/combobox";
import { ModelEsque } from "./providerIconUtils";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { TooltipProvider } from "../ui/tooltip";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import {
  getDescriptorStringValue,
  getTraitsSectionVisibility,
  replaceDescriptorCurrentValue,
} from "./TraitsPicker";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  continuationGroupKey?: string | undefined;
  isLegacy?: boolean | undefined;
};

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();

function ModelListSeparator() {
  return <div className="h-0.5" />;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  /** The instance currently selected in the composer (combobox "value"). */
  activeInstanceId: ProviderInstanceId;
  model: string;
  /**
   * When set, the picker is locked to the given driver kind — typically
   * because the user is editing a previously-sent message and can't change
   * which driver served the turn. Multiple instances of the same kind
   * remain selectable (e.g. locked to `codex` still lets the user switch
   * between the default Codex and a custom Codex Personal).
   */
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /**
   * All configured provider instances in display order. Used to render
   * the sidebar (one button per instance) and to resolve display names
   * for the locked-mode header.
   */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  /**
   * Model options per instance. Keyed by `ProviderInstanceId` so the
   * default Codex instance and any custom Codex instances each have their
   * own list (custom instances typically start with the same built-in
   * model set but are free to diverge via customModels).
   */
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  models?: ReadonlyArray<ServerProviderModel> | undefined;
  modelOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  onModelOptionsChange?: ((nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined) => void) | undefined;
  prompt?: string | undefined;
  onPromptChange?: ((prompt: string) => void) | undefined;
}) {
  const {
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<LegendListRef | null>(null);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const favorites = useClientSettings((s) => s.favorites ?? []);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | "favorites">(
    () => {
      if (props.lockedProvider !== null) {
        // When locked, prime the sidebar to the currently-active instance
        // so jumping into the picker keeps the focused instance visible.
        return props.activeInstanceId;
      }
      return favorites.length > 0 ? "favorites" : props.activeInstanceId;
    },
  );
  const [expandedLegacyInstances, setExpandedLegacyInstances] = useState(
    () =>
      new Set<ProviderInstanceId>(
        modelOptionsByInstance
          .get(props.activeInstanceId)
          ?.some((model) => model.slug === props.model && model.isLegacy)
          ? [props.activeInstanceId]
          : [],
      ),
  );
  const keybindings = useMemo<ResolvedKeybindingsConfig>(
    () => providedKeybindings ?? [],
    [providedKeybindings],
  );
  const updateSettings = useUpdateClientSettings();

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectInstance = useCallback(
    (instanceId: ProviderInstanceId | "favorites") => {
      setSelectedInstanceId(instanceId);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  useLayoutEffect(() => {
    focusSearchInput();
    const frame = window.requestAnimationFrame(() => {
      focusSearchInput();
    });
    const timeout = window.setTimeout(() => {
      focusSearchInput();
    }, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSearchInput]);

  // Create a Set for efficient lookup. Favorites are keyed by
  // `${instanceId}:${slug}`; the storage schema widened from ProviderDriverKind
  // to ProviderInstanceId so pre-migration favorites keyed by driver slugs
  // (e.g. `"codex:gpt-5"`) still resolve — the default instance id equals
  // the driver slug.
  const favoritesSet = useMemo(() => {
    return new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  }, [favorites]);

  /**
   * Lookup table keyed by `instanceId`. Used for display name + driver
   * kind enrichment and for `ready`/enabled filtering before flattening
   * models into the search list.
   */
  const entryByInstanceId = useMemo(
    () => new Map(instanceEntries.map((entry) => [entry.instanceId, entry])),
    [instanceEntries],
  );
  const matchesLockedProvider = useCallback(
    (entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">): boolean => {
      if (props.lockedProvider === null) return true;
      if (entry.driverKind !== props.lockedProvider) return false;
      if (!props.lockedContinuationGroupKey) return true;
      return entry.continuationGroupKey === props.lockedContinuationGroupKey;
    },
    [props.lockedContinuationGroupKey, props.lockedProvider],
  );

  const readyInstanceSet = useMemo(() => {
    const ready = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (isProviderInstancePickerReady(entry)) {
        ready.add(entry.instanceId);
      }
    }
    return ready;
  }, [instanceEntries]);

  // Flatten models into a searchable array. One pass over the
  // instance-keyed map; each model carries its instance id + driver kind
  // so the list row can render the right icon and display name without
  // another lookup.
  const flatModels = useMemo(() => {
    const out: ModelPickerItem[] = [];
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        // Instance disappeared between renders (configuration change). Skip
        // its models — stale options shouldn't appear in the picker.
        continue;
      }
      if (!readyInstanceSet.has(instanceId)) {
        continue;
      }
      for (const model of models) {
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.isLegacy ? { isLegacy: true } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return out;
  }, [modelOptionsByInstance, entryByInstanceId, readyInstanceSet]);

  const isLocked = props.lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const lockedDisabledInstanceIds = useMemo(() => {
    if (!isLocked) {
      return undefined;
    }
    const disabled = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (!matchesLockedProvider(entry)) {
        disabled.add(entry.instanceId);
      }
    }
    return disabled;
  }, [instanceEntries, isLocked, matchesLockedProvider]);
  const sidebarInstanceEntries = useMemo(() => {
    const enabledEntries = instanceEntries.filter(isProviderInstancePickerVisible);
    if (!isLocked) {
      return enabledEntries;
    }
    const available: ProviderInstanceEntry[] = [];
    const disabled: ProviderInstanceEntry[] = [];
    for (const entry of enabledEntries) {
      if (matchesLockedProvider(entry)) {
        available.push(entry);
      } else {
        disabled.push(entry);
      }
    }
    return [...available, ...disabled];
  }, [instanceEntries, isLocked, matchesLockedProvider]);
  const showSidebar = !isSearching && sidebarInstanceEntries.length > 0;
  const instanceOrder = useMemo(
    () => instanceEntries.map((entry) => entry.instanceId),
    [instanceEntries],
  );

  // Filter models based on search query and selected instance
  const filteredModels = useMemo(() => {
    let result = flatModels;

    // Apply tokenized fuzzy search across the combined provider/model search fields.
    if (searchQuery.trim()) {
      const rankedMatches = result
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(
            {
              name: model.name,
              ...(model.shortName ? { shortName: model.shortName } : {}),
              ...(model.subProvider ? { subProvider: model.subProvider } : {}),
              driverKind: model.driverKind,
              providerDisplayName: model.instanceDisplayName,
              isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
            },
            searchQuery,
          ),
          isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
          tieBreaker: buildModelPickerSearchText({
            name: model.name,
            ...(model.shortName ? { shortName: model.shortName } : {}),
            ...(model.subProvider ? { subProvider: model.subProvider } : {}),
            driverKind: model.driverKind,
            providerDisplayName: model.instanceDisplayName,
          }),
        }))
        .filter(
          (
            rankedModel,
          ): rankedModel is {
            model: ModelPickerItem;
            score: number;
            isFavorite: boolean;
            tieBreaker: string;
          } => rankedModel.score !== null,
        );

      // When searching, we only respect locked provider (by driver kind),
      // ignoring sidebar selection so account-scoped searches can find a
      // model before the user chooses a specific instance rail item.
      if (props.lockedProvider !== null) {
        const lockedProviderMatches: Array<(typeof rankedMatches)[number]> = [];
        for (const rankedModel of rankedMatches) {
          if (matchesLockedProvider(rankedModel.model)) {
            lockedProviderMatches.push(rankedModel);
          }
        }
        return lockedProviderMatches
          .toSorted((a, b) => {
            const scoreDelta = a.score - b.score;
            if (scoreDelta !== 0) {
              return scoreDelta;
            }
            if (a.isFavorite !== b.isFavorite) {
              return a.isFavorite ? -1 : 1;
            }
            return a.tieBreaker.localeCompare(b.tieBreaker);
          })
          .map((rankedModel) => rankedModel.model);
      }

      return rankedMatches
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          if (a.isFavorite !== b.isFavorite) {
            return a.isFavorite ? -1 : 1;
          }
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    if (props.lockedProvider !== null) {
      result = result.filter((m) => matchesLockedProvider(m));
      if (selectedInstanceId === "favorites") {
        result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
      } else {
        result = result.filter((m) => m.instanceId === selectedInstanceId);
      }
    } else if (selectedInstanceId === "favorites") {
      result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
    } else {
      result = result.filter((m) => m.instanceId === selectedInstanceId);
    }

    return sortProviderModelItems(result, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: selectedInstanceId !== "favorites",
      instanceOrder: selectedInstanceId === "favorites" ? instanceOrder : [],
    });
  }, [
    favoritesSet,
    flatModels,
    instanceOrder,
    matchesLockedProvider,
    props.lockedProvider,
    searchQuery,
    selectedInstanceId,
  ]);

  const legacySection = useMemo(() => {
    if (isSearching || selectedInstanceId === "favorites") {
      return null;
    }
    const currentModels = filteredModels.filter((model) => !model.isLegacy);
    const legacyModels = filteredModels.filter((model) => model.isLegacy);
    if (legacyModels.length === 0) {
      return null;
    }
    return {
      key: modelPickerLegacySectionKey(selectedInstanceId),
      currentModels,
      legacyModels,
      isExpanded: expandedLegacyInstances.has(selectedInstanceId),
    };
  }, [expandedLegacyInstances, filteredModels, isSearching, selectedInstanceId]);

  const visibleModels = useMemo(() => {
    if (!legacySection) {
      return filteredModels;
    }
    return [
      ...legacySection.currentModels,
      ...(legacySection.isExpanded ? legacySection.legacyModels : []),
    ];
  }, [filteredModels, legacySection]);

  const toggleLegacySection = useCallback((instanceId: ProviderInstanceId) => {
    setExpandedLegacyInstances((expanded) => {
      const next = new Set(expanded);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }, []);

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId) => {
      if (getModelDisabledReason?.(instanceId, modelSlug)) {
        return;
      }
      const options = modelOptionsByInstance.get(instanceId);
      if (!options) {
        return;
      }
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        return;
      }
      // `resolveSelectableModel` uses the driver kind for normalization
      // (slug casing etc.). Custom instances share their driver's
      // normalization rules, so pass the driver kind here.
      const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, options);
      if (resolvedModel) {
        onInstanceModelChange(instanceId, resolvedModel);
      }
    },
    [entryByInstanceId, getModelDisabledReason, modelOptionsByInstance, onInstanceModelChange],
  );

  const toggleFavorite = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const newFavorites = [...favorites];
      const index = newFavorites.findIndex((f) => f.provider === instanceId && f.model === model);
      if (index >= 0) {
        newFavorites.splice(index, 1);
      } else {
        newFavorites.push({ provider: instanceId, model });
      }
      updateSettings({ favorites: newFavorites });
    },
    [favorites, updateSettings],
  );

  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<
      string,
      NonNullable<ReturnType<typeof modelPickerJumpCommandForIndex>>
    >();
    let selectableModelIndex = 0;
    for (const model of visibleModels) {
      if (getModelDisabledReason?.(model.instanceId, model.slug)) {
        continue;
      }
      const jumpCommand = modelPickerJumpCommandForIndex(selectableModelIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(modelPickerModelKey(model.instanceId, model.slug), jumpCommand);
      selectableModelIndex += 1;
    }
    return mapping;
  }, [getModelDisabledReason, visibleModels]);
  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  const allItemKeys = useMemo(
    (): string[] => [
      ...flatModels.map((model) => modelPickerModelKey(model.instanceId, model.slug)),
      ...new Set(
        flatModels
          .filter((model) => model.isLegacy)
          .map((model) => modelPickerLegacySectionKey(model.instanceId)),
      ),
    ],
    [flatModels],
  );
  const filteredItemKeys = useMemo((): string[] => {
    const modelKeys = visibleModels.map((model) =>
      modelPickerModelKey(model.instanceId, model.slug),
    );
    if (!legacySection) {
      return modelKeys;
    }
    modelKeys.splice(legacySection.currentModels.length, 0, legacySection.key);
    return modelKeys;
  }, [legacySection, visibleModels]);
  const filteredModelByKey = useMemo(
    (): ReadonlyMap<string, ModelPickerItem> =>
      new Map(
        visibleModels.map(
          (model) => [modelPickerModelKey(model.instanceId, model.slug), model] as const,
        ),
      ),
    [visibleModels],
  );
  const updateModelListScrollFades = useCallback(() => {
    const scrollElement = modelListRef.current?.getScrollableNode();
    if (!(scrollElement instanceof HTMLElement)) {
      return;
    }
    const maxScrollOffset = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    setShowTopScrollFade(scrollElement.scrollTop > 1);
    setShowBottomScrollFade(maxScrollOffset - scrollElement.scrollTop > 1);
  }, []);
  const modelJumpShortcutContext = useMemo(
    () =>
      ({
        terminalFocus: false,
        terminalOpen: props.terminalOpen,
        modelPickerOpen: true,
      }) as const,
    [props.terminalOpen],
  );
  const modelJumpLabelByKey = useMemo((): ReadonlyMap<string, string> => {
    if (modelJumpCommandByKey.size === 0) {
      return EMPTY_MODEL_JUMP_LABELS;
    }
    const shortcutLabelOptions = {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    };
    const mapping = new Map<string, string>();
    for (const [modelKey, command] of modelJumpCommandByKey) {
      const label = shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
      if (label) {
        mapping.set(modelKey, label);
      }
    }
    return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
  }, [keybindings, modelJumpCommandByKey, modelJumpShortcutContext]);
  const modelListExtraData = useMemo(
    () => ({ favoritesSet, modelJumpLabelByKey }),
    [favoritesSet, modelJumpLabelByKey],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: modelJumpShortcutContext,
      });
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetModelKey = modelJumpModelKeys[jumpIndex];
      if (!targetModelKey) {
        return;
      }
      const model = parseModelPickerModelKey(targetModelKey);
      if (!model) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleModelSelect(model.slug, model.instanceId);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [handleModelSelect, keybindings, modelJumpModelKeys, modelJumpShortcutContext]);

  const traitsVisibility = useMemo(() => {
    const activeEntry = entryByInstanceId.get(props.activeInstanceId);
    if (!props.models || !activeEntry) return null;
    return getTraitsSectionVisibility({
      provider: activeEntry.driverKind,
      models: props.models,
      model: props.model,
      prompt: props.prompt ?? "",
      modelOptions: props.modelOptions,
      allowPromptInjectedEffort: true,
    });
  }, [
    entryByInstanceId,
    props.activeInstanceId,
    props.model,
    props.modelOptions,
    props.models,
    props.prompt,
  ]);

  const updateDescriptors = useCallback(
    (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
      props.onModelOptionsChange?.(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
    },
    [props],
  );

  const handleSelectOptionChange = useCallback(
    (
      descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
      value: string,
    ) => {
      if (!value || !traitsVisibility) return;
      if (descriptor.promptInjectedValues?.includes(value)) {
        const nextPrompt =
          (props.prompt ?? "").trim().length === 0
            ? "Ultrathink:\n"
            : applyClaudePromptEffortPrefix(props.prompt ?? "", "ultrathink");
        props.onPromptChange?.(nextPrompt);
        return;
      }
      if (
        traitsVisibility.ultrathinkInBodyText &&
        descriptor.id === traitsVisibility.primarySelectDescriptor?.id
      ) {
        return;
      }
      if (
        traitsVisibility.ultrathinkPromptControlled &&
        descriptor.id === traitsVisibility.primarySelectDescriptor?.id
      ) {
        const stripped = (props.prompt ?? "").replace(/^Ultrathink:\s*/i, "");
        props.onPromptChange?.(stripped);
      }
      updateDescriptors(
        replaceDescriptorCurrentValue(traitsVisibility.descriptors, descriptor.id, value),
      );
    },
    [props, traitsVisibility, updateDescriptors],
  );

  const handleToggleBooleanOption = useCallback(
    (descriptor: Extract<ProviderOptionDescriptor, { type: "boolean" }>) => {
      if (!traitsVisibility) return;
      const nextValue = descriptor.currentValue !== true;
      updateDescriptors(
        replaceDescriptorCurrentValue(traitsVisibility.descriptors, descriptor.id, nextValue),
      );
    },
    [traitsVisibility, updateDescriptors],
  );

  useLayoutEffect(() => {
    setShowTopScrollFade(false);
    setShowBottomScrollFade(filteredItemKeys.length > 5);
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      updateModelListScrollFades();
      nestedFrame = window.requestAnimationFrame(updateModelListScrollFades);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
    };
  }, [filteredItemKeys, updateModelListScrollFades]);

  return (
    <TooltipProvider delay={0}>
      <div
        className="dropdown-glass model-picker-surface relative flex h-screen max-h-[32rem] w-screen max-w-[28rem] flex-row overflow-hidden rounded-xl border border-border/80 text-popover-foreground shadow-2xl backdrop-blur-xl [clip-path:inset(0_round_var(--radius-xl))]"
        data-model-picker-content="true"
      >
        {/* Sidebar */}
        {showSidebar && (
          <ModelPickerSidebar
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={handleSelectInstance}
            instanceEntries={sidebarInstanceEntries}
            showFavorites
            {...(lockedDisabledInstanceIds
              ? {
                  disabledInstanceIds: lockedDisabledInstanceIds,
                  getDisabledInstanceTooltip: (entry: ProviderInstanceEntry) =>
                    `${entry.displayName} is unavailable in this thread. Start a new thread to switch providers.`,
                }
              : {})}
          />
        )}

        {/* Main content area */}
        <Combobox
          inline
          items={allItemKeys}
          filteredItems={filteredItemKeys}
          filter={null}
          autoHighlight
          open
          virtualized
          value={modelPickerModelKey(props.activeInstanceId, props.model)}
          onItemHighlighted={(modelKey, eventDetails) => {
            highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
            if (eventDetails.reason === "keyboard" && eventDetails.index >= 0) {
              void modelListRef.current?.scrollIndexIntoView?.({
                index: eventDetails.index,
                animated: false,
              });
            }
          }}
          onValueChange={(modelKey) => {
            if (typeof modelKey !== "string") {
              return;
            }
            const legacyInstanceId = parseModelPickerLegacySectionKey(modelKey);
            if (legacyInstanceId) {
              toggleLegacySection(legacyInstanceId);
              return;
            }
            const model = parseModelPickerModelKey(modelKey);
            if (model) {
              handleModelSelect(model.slug, model.instanceId);
            }
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/50">
            {/* Search bar */}
            <div className="p-3 pb-2">
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 transition-colors focus-within:border-primary/60 focus-within:bg-background/70 focus-within:ring-1 focus-within:ring-primary/40">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                <ComboboxInput
                  ref={searchInputRef}
                  className="[&_input]:h-6 [&_input]:font-sans [&_input]:leading-6"
                  inputClassName="rounded-none bg-transparent text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/70"
                  placeholder="Search models..."
                  showTrigger={false}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onRequestClose?.();
                      return;
                    }
                    if (e.key === "Enter" && highlightedModelKeyRef.current) {
                      (
                        e as typeof e & { preventBaseUIHandler?: () => void }
                      ).preventBaseUIHandler?.();
                      e.preventDefault();
                      e.stopPropagation();
                      const legacyInstanceId = parseModelPickerLegacySectionKey(
                        highlightedModelKeyRef.current,
                      );
                      if (legacyInstanceId) {
                        toggleLegacySection(legacyInstanceId);
                        return;
                      }
                      const model = parseModelPickerModelKey(highlightedModelKeyRef.current);
                      if (model) {
                        handleModelSelect(model.slug, model.instanceId);
                      }
                      return;
                    }
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  size="sm"
                  unstyled
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>

            {/* Model list */}
            <div className="relative min-h-0 flex-1 overflow-hidden px-2">
              <ComboboxListVirtualized className="size-full min-w-0 p-0 not-empty:p-0">
                <LegendList<string>
                  ref={modelListRef}
                  data={filteredItemKeys}
                  extraData={modelListExtraData}
                  keyExtractor={(modelKey) => modelKey}
                  renderItem={({ item: modelKey, index }) => {
                    if (legacySection?.key === modelKey) {
                      return (
                        <ComboboxItem
                          hideIndicator
                          index={index}
                          value={modelKey}
                          aria-expanded={legacySection.isExpanded}
                          className="group w-full cursor-pointer rounded-lg px-2.5 py-2 hover:bg-muted/60"
                          contentClassName="flex w-full items-center gap-3"
                        >
                          <div className="min-w-0 flex-1 text-left">
                            <div className="text-xs font-semibold leading-snug">Legacy models</div>
                            <div className="mt-0.5 text-[11px] font-normal leading-snug text-muted-foreground/70">
                              {legacySection.legacyModels.length} models
                            </div>
                          </div>
                          <ChevronRightIcon
                            className={cn(
                              "size-4 transition-transform text-muted-foreground",
                              legacySection.isExpanded && "rotate-90",
                            )}
                          />
                        </ComboboxItem>
                      );
                    }
                    const model = filteredModelByKey.get(modelKey);
                    if (!model) {
                      return null;
                    }
                    const disabledReason =
                      getModelDisabledReason?.(model.instanceId, model.slug) ?? null;
                    return (
                      <ModelListRow
                        key={modelKey}
                        index={index}
                        model={model}
                        instanceId={model.instanceId}
                        driverKind={model.driverKind}
                        providerDisplayName={model.instanceDisplayName}
                        providerAccentColor={model.instanceAccentColor}
                        isFavorite={favoritesSet.has(
                          providerModelKey(model.instanceId, model.slug),
                        )}
                        isSelected={
                          modelKey === modelPickerModelKey(props.activeInstanceId, props.model)
                        }
                        showProvider
                        preferShortName={!isLocked}
                        useTriggerLabel={false}
                        showNewBadge={isModelPickerNewModel(model.driverKind, model.slug)}
                        jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                        disabledReason={disabledReason}
                        onToggleFavorite={() => toggleFavorite(model.instanceId, model.slug)}
                        onDoubleClick={() => {
                          if (disabledReason) return;
                          handleModelSelect(model.slug, model.instanceId);
                          props.onRequestClose?.();
                        }}
                      />
                    );
                  }}
                  estimatedItemSize={48}
                  drawDistance={480}
                  recycleItems
                  contentContainerClassName="space-y-1 py-1"
                  ItemSeparatorComponent={ModelListSeparator}
                  onLayout={updateModelListScrollFades}
                  onScroll={updateModelListScrollFades}
                  className={cn(
                    "model-picker-list scrollbar-gutter-stable h-full overflow-x-hidden overscroll-y-contain [--fade-size:1.5rem]",
                    showTopScrollFade && "model-picker-list-scroll-fade-top",
                    showBottomScrollFade && "model-picker-list-scroll-fade-bottom",
                  )}
                />
              </ComboboxListVirtualized>
            </div>

            {/* Traits / Reasoning Effort & Options section if available */}
            {traitsVisibility && traitsVisibility.hasAnyControls ? (
              <div
                data-model-picker-traits="true"
                className="space-y-2.5 border-t border-border/60 bg-muted/15 px-3.5 py-2.5"
              >
                {traitsVisibility.selectDescriptors.map((descriptor) => {
                  const selectedValue =
                    traitsVisibility.ultrathinkPromptControlled &&
                    descriptor.id === traitsVisibility.primarySelectDescriptor?.id
                      ? "ultrathink"
                      : (getDescriptorStringValue(descriptor) ?? "");

                  const isReasoning =
                    descriptor.label.toLowerCase().includes("effort") ||
                    descriptor.label.toLowerCase().includes("reasoning");

                  if (isReasoning && descriptor.options.length > 0) {
                    const disabled =
                      traitsVisibility.ultrathinkInBodyText &&
                      descriptor.id === traitsVisibility.primarySelectDescriptor?.id;

                    return (
                      <ReasoningEffortSlider
                        key={descriptor.id}
                        descriptor={descriptor}
                        selectedValue={selectedValue}
                        disabled={disabled}
                        promptControlled={traitsVisibility.ultrathinkPromptControlled}
                        onSelect={(optionId) => {
                          handleSelectOptionChange(descriptor, optionId);
                        }}
                      />
                    );
                  }

                  const headerLabel = descriptor.label.toUpperCase();

                  return (
                    <div key={descriptor.id} className="space-y-1.5">
                      <div className="flex items-center justify-between px-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                          {headerLabel}
                        </span>
                        {traitsVisibility.ultrathinkPromptControlled && (
                          <span className="text-[10px] font-medium text-amber-500">
                            Prompt-controlled
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {descriptor.options.map((option) => {
                          const isSelected = selectedValue === option.id;
                          const disabled =
                            traitsVisibility.ultrathinkInBodyText &&
                            descriptor.id === traitsVisibility.primarySelectDescriptor?.id;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={disabled}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleSelectOptionChange(descriptor, option.id);
                              }}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150",
                                isSelected
                                  ? "border border-primary/60 bg-primary/15 text-primary font-semibold shadow-xs"
                                  : "border border-border/40 bg-muted/40 text-muted-foreground hover:border-border/70 hover:bg-muted/80 hover:text-foreground",
                                disabled && "cursor-not-allowed opacity-40",
                              )}
                            >
                              <span>{option.label}</span>
                              {option.isDefault && (
                                <span
                                  className={cn(
                                    "text-[9px] opacity-70",
                                    isSelected ? "text-primary" : "text-muted-foreground",
                                  )}
                                >
                                  (default)
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {traitsVisibility.booleanDescriptors.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="px-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                        SERVICE TIER / OPTIONS
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {traitsVisibility.booleanDescriptors.map((descriptor) => {
                        const isChecked = descriptor.currentValue === true;
                        return (
                          <button
                            key={descriptor.id}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleToggleBooleanOption(descriptor);
                            }}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150",
                              isChecked
                                ? "border border-primary/60 bg-primary/15 text-primary font-semibold shadow-xs"
                                : "border border-border/40 bg-muted/40 text-muted-foreground hover:border-border/70 hover:bg-muted/80 hover:text-foreground",
                            )}
                          >
                            <span>{descriptor.label}</span>
                            <span
                              className={cn(
                                "rounded px-1 text-[9px] font-bold uppercase",
                                isChecked
                                  ? "bg-primary/20 text-primary"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {isChecked ? "On" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <ComboboxEmpty className="not-empty:py-6 empty:h-0 text-xs font-normal leading-snug text-muted-foreground">
              No models found
            </ComboboxEmpty>

            {/* Bottom footer */}
            <div className="flex items-center justify-between border-t border-border/60 bg-muted/25 px-3.5 py-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <InfoIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span>Applies to selected model</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Kbd className="h-4 rounded border border-border/50 bg-muted/60 px-1 font-mono text-[9px]">↑↓</Kbd>
                  <span>navigate</span>
                </div>
                <div className="flex items-center gap-1">
                  <Kbd className="h-4 rounded border border-border/50 bg-muted/60 px-1.5 font-mono text-[9px]">↵</Kbd>
                  <span>select</span>
                </div>
              </div>
            </div>
          </div>
        </Combobox>
      </div>
    </TooltipProvider>
  );
});
