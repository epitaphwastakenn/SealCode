import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "./models.ts";

export type ProjectLastUsedSettingsThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "modelSelection" | "runtimeMode" | "interactionMode" | "updatedAt"
> & {
  readonly latestUserAuthoredMessageAt?: string | null;
  readonly lineage?: Pick<EnvironmentThreadShell["lineage"], "relationshipToParent">;
};

export interface ProjectLastUsedSettings {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/**
 * The composer settings of the project's most recently used thread. Agents
 * pick subagent settings, so those threads say nothing about the user's choice.
 */
export function resolveProjectLastUsedSettings(
  threads: ReadonlyArray<ProjectLastUsedSettingsThread>,
  project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): ProjectLastUsedSettings | null {
  let latest: ProjectLastUsedSettingsThread | null = null;
  let latestAt = "";
  for (const thread of threads) {
    if (
      thread.environmentId !== project.environmentId ||
      thread.projectId !== project.projectId ||
      thread.lineage?.relationshipToParent === "subagent"
    ) {
      continue;
    }
    const usedAt = thread.latestUserAuthoredMessageAt ?? thread.updatedAt;
    if (latest === null || usedAt > latestAt) {
      latest = thread;
      latestAt = usedAt;
    }
  }
  return latest === null
    ? null
    : {
        modelSelection: latest.modelSelection,
        runtimeMode: latest.runtimeMode,
        interactionMode: latest.interactionMode,
      };
}
