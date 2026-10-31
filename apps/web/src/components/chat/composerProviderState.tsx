import {
  type ModelCapabilities,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  migrateLegacyUltracodeOptions,
  normalizeModelSlug,
} from "@t3tools/shared/model";
import type { ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import type { ComposerControlSize } from "./ComposerControl";
import {
  getReasoningTraitStep,
  shouldRenderTraitsControls,
  TraitsMenuContent,
  TraitsPicker,
} from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  planModeEnabled: boolean;
};

const COMPOSER_MAX_EFFORT_FRAME = {
  composerFrameClassName: "max-effort-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
} as const;

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  planModeEnabled: boolean;
  size?: ComposerControlSize;
  hidden?: boolean;
  triggerClassName?: string;
  isComposerOwned?: boolean;
};

/**
 * Cursor ACP can report `fastMode: true` as the provider default. T3 only
 * treats Fast as selected when the user chose it (draft/sticky/settings).
 */
export function withImplicitFastModeDefault(
  caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const hasExplicitFastMode = modelOptions?.some((selection) => selection.id === "fastMode");
  if (hasExplicitFastMode) {
    return modelOptions ?? undefined;
  }
  const hasFastModeDescriptor = caps.optionDescriptors?.some(
    (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  if (!hasFastModeDescriptor) {
    return modelOptions ?? undefined;
  }
  return [...(modelOptions ?? []), { id: "fastMode", value: false }];
}

function resolveComposerOptionSelections(
  models: ReadonlyArray<ServerProviderModel>,
  model: string,
  provider: ProviderDriverKind,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  planModeEnabled: boolean,
): {
  caps: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | undefined;
} {
  const caps = getProviderModelCapabilities(models, model, provider, planModeEnabled);
  return {
    caps,
    selections: withImplicitFastModeDefault(caps, migrateLegacyUltracodeOptions(modelOptions)),
  };
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, modelOptions, planModeEnabled } = input;
  if (provider === "opencode") {
    const normalizedModel = normalizeModelSlug(model, provider);
    const modelIsInCatalog = models.some((candidate) => candidate.slug === normalizedModel);
    if (!modelIsInCatalog) {
      const preservedOptions = modelOptions?.filter(
        (option) => planModeEnabled || option.id !== "agent" || option.value !== "plan",
      );
      return {
        provider,
        promptEffort: null,
        modelOptionsForDispatch:
          preservedOptions && preservedOptions.length > 0 ? preservedOptions : undefined,
      };
    }
  }
  const { caps, selections } = resolveComposerOptionSelections(
    models,
    model,
    provider,
    modelOptions,
    planModeEnabled,
  );
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const lastEffortOption = primarySelectDescriptor?.options.at(-1);
  const isMaximumEffort =
    (primarySelectDescriptor?.options.length ?? 0) > 1 &&
    promptEffort !== null &&
    promptEffort === lastEffortOption?.id;

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildExplicitProviderOptionSelectionsFromDescriptors(
      descriptors,
      selections,
    ),
    ...(isMaximumEffort ? COMPOSER_MAX_EFFORT_FRAME : {}),
  };
}

export function getComposerReasoningStep(input: {
  provider: ProviderDriverKind;
  instanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  planModeEnabled: boolean;
  direction: 1 | -1;
}): { modelOptions: ReadonlyArray<ProviderOptionSelection> } | null {
  const { selections } = resolveComposerOptionSelections(
    input.models,
    input.model,
    input.provider,
    input.modelOptions,
    input.planModeEnabled,
  );
  return getReasoningTraitStep({
    provider: input.provider,
    instanceId: input.instanceId,
    model: input.model,
    models: input.models,
    modelOptions: selections,
    reportedModelSelection: input.reportedModelSelection,
    planModeEnabled: input.planModeEnabled,
    direction: input.direction,
  });
}

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    reportedModelSelection,
    planModeEnabled,
    size,
    hidden,
    triggerClassName,
    isComposerOwned,
  } = input;
  const hasTarget = threadRef !== undefined || draftId !== undefined;
  const { selections: resolvedModelOptions } = resolveComposerOptionSelections(
    models,
    model,
    provider,
    modelOptions,
    planModeEnabled,
  );
  if (
    !hasTarget ||
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      modelOptions: resolvedModelOptions,
      planModeEnabled,
    })
  ) {
    return null;
  }
  return (
    <Component
      provider={provider}
      {...(instanceId ? { instanceId } : {})}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={resolvedModelOptions}
      reportedModelSelection={reportedModelSelection}
      planModeEnabled={planModeEnabled}
      {...(size !== undefined ? { size } : {})}
      {...(hidden !== undefined ? { hidden } : {})}
      {...(triggerClassName !== undefined ? { triggerClassName } : {})}
      {...(isComposerOwned ? { isComposerOwned } : {})}
    />
  );
}

export function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

export function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}
