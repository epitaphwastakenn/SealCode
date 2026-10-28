import type { ReactNode } from "react";
import type { ChatComposerProps } from "./ChatComposer";
import { CircleAlertIcon } from "lucide-react";
import { AgentPresetPicker } from "./AgentPresetPicker";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerControl, ComposerControlSeparator } from "./ComposerControl";
import { ComposerFooterModeControls, type RuntimeModeOption } from "./ComposerFooterControls";
import type {
  AgentPreset,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import { cn } from "~/lib/utils";

/**
 * The composer footer controls: attach, mode controls, agent presets and the overflow menu for
 * blocks that do not fit. Rendered in the expanded footer or the resting controls host. Harp
 * keeps the model picker (with its reasoning level) and the usage meter on the right of the
 * expanded footer, so they render here only while the composer rests.
 */
export function ComposerControlsBar(props: {
  planModeUiEnabled: boolean;
  interactionMode: ProviderInteractionMode;
  compatibleRuntimeMode: RuntimeMode;
  compatibleRuntimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  composerControlsCollapsed: boolean;
  composerControlsHidden: boolean;
  restingHiddenBlockCount: number;
  iconOnlyBlockCount: number;
  showLeadingSeparator: boolean;
  showProviderUnavailable: boolean;
  providerSetupInstanceId: ProviderInstanceId | undefined;
  onOpenProviderSetup: ChatComposerProps["onOpenProviderSetup"];
  modelPicker: ReactNode;
  usageMeter: ReactNode;
  agentPresets: ReadonlyArray<AgentPreset>;
  onSelectAgentPreset: (preset: AgentPreset) => void;
  attachButton: ReactNode;
}) {
  const {
    planModeUiEnabled,
    interactionMode,
    compatibleRuntimeMode,
    compatibleRuntimeModeOptions,
    toggleInteractionMode,
    handleRuntimeModeChange,
    composerControlsCollapsed,
    composerControlsHidden,
    restingHiddenBlockCount,
    iconOnlyBlockCount,
    showLeadingSeparator,
    showProviderUnavailable,
    providerSetupInstanceId,
    onOpenProviderSetup,
    modelPicker,
    usageMeter,
    agentPresets,
    onSelectAgentPreset,
    attachButton,
  } = props;
  const restingBlockDefs = [
    {
      id: "mode",
      content: (
        <ComposerFooterModeControls
          showInteractionModeToggle={planModeUiEnabled}
          interactionMode={interactionMode}
          runtimeMode={compatibleRuntimeMode}
          runtimeModeOptions={compatibleRuntimeModeOptions}
          size={composerControlsCollapsed ? "xs" : "sm"}
          hidden={composerControlsHidden || restingHiddenBlockCount > 0}
          onToggleInteractionMode={toggleInteractionMode}
          onRuntimeModeChange={handleRuntimeModeChange}
        />
      ),
    },
    ...(agentPresets.length > 0
      ? [
          {
            id: "presets",
            content: (
              <AgentPresetPicker
                presets={agentPresets}
                compact={composerControlsCollapsed}
                onSelect={onSelectAgentPreset}
              />
            ),
          },
        ]
      : []),
  ];
  const hiddenRestingBlockIds = restingBlockDefs
    .slice(restingBlockDefs.length - restingHiddenBlockCount)
    .map((def) => def.id);
  return showProviderUnavailable ? (
    <ComposerControl
      type="button"
      disabled={!providerSetupInstanceId}
      onClick={() => {
        if (providerSetupInstanceId) {
          onOpenProviderSetup(providerSetupInstanceId);
        }
      }}
      data-chat-provider-unavailable="true"
      className="shrink-0"
    >
      <CircleAlertIcon className="size-4" />
      {providerSetupInstanceId ? "Open provider settings" : "No provider available"}
    </ComposerControl>
  ) : (
    <>
      {showLeadingSeparator ? (
        <ComposerControlSeparator
          size="xs"
          className="@max-[400px]/composer-surface:hidden"
          data-resting-controls-separator="true"
        />
      ) : null}
      {attachButton}
      {composerControlsCollapsed ? modelPicker : null}
      {composerControlsCollapsed ? usageMeter : null}

      <>
        {restingBlockDefs.map((def, index) => {
          const hidden = index >= restingBlockDefs.length - restingHiddenBlockCount;
          return (
            <div
              key={def.id}
              data-resting-block={def.id}
              data-composer-block-icon-only={
                index >= restingBlockDefs.length - iconOnlyBlockCount ? "true" : "false"
              }
              aria-hidden={hidden || undefined}
              inert={hidden || undefined}
              className={cn(
                "flex w-max min-w-max shrink-0 items-center gap-1",
                hidden && "pointer-events-none invisible absolute",
                index >= restingBlockDefs.length - iconOnlyBlockCount &&
                  "[&_[data-composer-control-label]]:pointer-events-none [&_[data-composer-control-label]]:invisible [&_[data-composer-control-label]]:absolute [&_[data-composer-control-label]]:w-max [&_[data-composer-control-label]]:max-w-none [&_[data-composer-control-compact-icon]]:[visibility:inherit] [&_[data-composer-control-compact-icon]]:relative",
              )}
            >
              {def.content}
            </div>
          );
        })}
        <div
          data-resting-controls-overflow
          aria-hidden={hiddenRestingBlockIds.length === 0 || undefined}
          inert={hiddenRestingBlockIds.length === 0 || undefined}
          className={cn(
            "min-w-0 shrink-0",
            hiddenRestingBlockIds.length === 0 && "pointer-events-none invisible absolute",
          )}
        >
          <CompactComposerControlsMenu
            interactionMode={interactionMode}
            runtimeMode={compatibleRuntimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
            size={composerControlsCollapsed ? "xs" : "sm"}
            hidden={composerControlsHidden || hiddenRestingBlockIds.length === 0}
            showInteractionModeToggle={planModeUiEnabled && hiddenRestingBlockIds.includes("mode")}
            onToggleInteractionMode={toggleInteractionMode}
            onRuntimeModeChange={handleRuntimeModeChange}
          />
        </div>
      </>
    </>
  );
}
