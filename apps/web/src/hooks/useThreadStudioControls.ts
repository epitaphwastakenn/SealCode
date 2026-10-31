import type {
  EnvironmentId,
  OrchestrationV2StudioControls,
  ProjectId,
  RobloxStudioPlace,
  ThreadId,
} from "@t3tools/contracts";
import {
  applyStudioControlsChange,
  type StudioControlsChange,
} from "@t3tools/shared/studioControls";

import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

const studioServerId = "studio";

function useStudioControlsSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.threadStudioControls === true
  );
}

export function useStudioControlsApply(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId?: ThreadId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly enabled: boolean;
}): boolean {
  const supported = useStudioControlsSupported(input.environmentId);
  const scope =
    input.threadId !== undefined
      ? { threadId: input.threadId }
      : input.projectId !== undefined
        ? { projectId: input.projectId }
        : null;
  const statuses = useEnvironmentQuery(
    input.enabled && supported && scope !== null
      ? serverEnvironment.mcpStatuses({ environmentId: input.environmentId, input: scope })
      : null,
  );
  return (
    input.enabled &&
    supported &&
    (statuses.data ?? []).some(
      (status) => status.id === studioServerId && status.state !== "disabled",
    )
  );
}

export function useStudioPlaces(
  environmentId: EnvironmentId,
  enabled: boolean,
): ReadonlyArray<RobloxStudioPlace> | undefined {
  const status = useEnvironmentQuery(
    enabled ? serverEnvironment.robloxStudioStatus({ environmentId, input: {} }) : null,
  );
  return status.data?.bridge?.places;
}

export function useThreadStudioControls(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly isDraft: boolean;
  readonly serverControls: OrchestrationV2StudioControls | undefined;
}): {
  readonly controls: OrchestrationV2StudioControls | undefined;
  readonly change: (change: StudioControlsChange) => void;
} {
  const draftControls = useComposerDraftStore(
    (store) => store.getComposerDraft(input.composerDraftTarget)?.studioControls ?? null,
  );
  const setDraftControls = useComposerDraftStore((store) => store.setStudioControls);
  const setServerControls = useOrchestrationCommand(
    threadEnvironment.setStudioControls,
    "update Studio controls",
  );
  const controls = input.isDraft ? (draftControls ?? undefined) : input.serverControls;
  const change = (next: StudioControlsChange) => {
    if (input.isDraft) {
      setDraftControls(input.composerDraftTarget, applyStudioControlsChange(draftControls, next));
      return;
    }
    void setServerControls({
      environmentId: input.environmentId,
      input: { threadId: input.threadId, ...next },
    });
  };
  return { controls, change };
}
