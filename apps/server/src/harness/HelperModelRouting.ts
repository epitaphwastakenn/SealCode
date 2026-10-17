import type { ModelSelection, ServerSettings } from "@t3tools/contracts";

export type HarnessHelperPurpose =
  | "contextCompactor"
  | "skillCurator"
  | "memoryCurator"
  | "delegationDefault";

type HelperSelectionKey = `${HarnessHelperPurpose}ModelSelection`;

const lowestEffort = ["minimal", "low", "medium", "high", "xhigh"] as const;

export function lowerEffortSelection(
  selection: ModelSelection,
  availableEfforts: ReadonlyArray<string>,
): ModelSelection {
  const effort = lowestEffort.find((candidate) => availableEfforts.includes(candidate));
  if (effort === undefined) return selection;
  return {
    ...selection,
    options: (selection.options ?? []).map((option) =>
      option.id === "reasoningEffort" || option.id === "effort"
        ? { ...option, value: effort }
        : option,
    ),
  };
}

export function resolveHarnessHelperModelSelection(
  settings: Pick<ServerSettings, "textGenerationModelSelection"> &
    Partial<Record<HelperSelectionKey, ModelSelection | null>>,
  purpose: HarnessHelperPurpose,
  availableEfforts: ReadonlyArray<string> = [],
): ModelSelection {
  const configured = settings[`${purpose}ModelSelection`];
  const selection = configured ?? settings.textGenerationModelSelection;
  return availableEfforts.length === 0 ? selection : lowerEffortSelection(selection, availableEfforts);
}

export const __testing = { lowestEffort };
