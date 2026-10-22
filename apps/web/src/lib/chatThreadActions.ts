import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ProjectLastUsedSettings } from "@t3tools/client-runtime/state/project-last-used-settings";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedProjectRef,
} from "@t3tools/contracts";
import type { ResolvedProjectSettings } from "@t3tools/shared/projectSettings";
import type { ComposerThreadDraftState, DraftThreadEnvMode } from "../composerDraftStore";

type ComposerModelSelectionState = Pick<
  ComposerThreadDraftState,
  "activeProvider" | "modelSelectionByProvider" | "modelSelectionExplicit"
>;

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

/**
 * What a new thread in a project starts with when the draft has no pick of its
 * own: a setting configured on the project itself wins, then the project's
 * last user-used settings, then environment defaults.
 */
export function resolveNewThreadDefaults(input: {
  readonly projectSettings: ResolvedProjectSettings;
  readonly lastUsed: ProjectLastUsedSettings | null;
}): {
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | null;
} {
  const { settings, sources } = input.projectSettings;
  return {
    modelSelection:
      (sources.defaultModelSelection === "environment" ? null : settings.defaultModelSelection) ??
      input.lastUsed?.modelSelection ??
      settings.defaultModelSelection,
    runtimeMode:
      (sources.defaultRuntimeMode === "environment" ? input.lastUsed?.runtimeMode : null) ??
      settings.defaultRuntimeMode,
    interactionMode: input.lastUsed?.interactionMode ?? null,
  };
}

export function hasExplicitComposerModelSelection(
  draft: ComposerModelSelectionState | null | undefined,
): boolean {
  const activeProvider = draft?.activeProvider;
  return (
    draft?.modelSelectionExplicit === true &&
    activeProvider !== null &&
    activeProvider !== undefined &&
    draft.modelSelectionByProvider[activeProvider] !== undefined
  );
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
