import type { EnvironmentId, OrchestrationV2StudioControls } from "@t3tools/contracts";
import { isStudioRestricted, type StudioControlsChange } from "@t3tools/shared/studioControls";
import { SlidersHorizontalIcon } from "lucide-react";
import { memo } from "react";

import { useStudioPlaces } from "../../hooks/useThreadStudioControls";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import { agentControlGroups } from "./ComposerAgentControlsMenu.logic";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

export interface AgentControlsBinding {
  readonly environmentId: EnvironmentId;
  readonly controls: OrchestrationV2StudioControls | undefined;
  readonly onChange: (change: StudioControlsChange) => void;
}

export function AgentControlsMenuContent(props: AgentControlsBinding) {
  const places = useStudioPlaces(props.environmentId, true);
  const groups = agentControlGroups({
    controls: props.controls,
    places,
    onChange: props.onChange,
  });
  return (
    <>
      {groups.map((group) => (
        <MenuGroup key={group.id}>
          <MenuGroupLabel>{group.label}</MenuGroupLabel>
          {group.items.map((item) => (
            <MenuCheckboxItem
              key={item.id}
              variant="switch"
              checked={item.checked}
              onCheckedChange={item.onCheckedChange}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{item.label}</span>
                {item.detail ? (
                  <span className="truncate text-2xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          ))}
          {group.items.length === 0 && group.emptyHint ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{group.emptyHint}</p>
          ) : null}
        </MenuGroup>
      ))}
    </>
  );
}

export const ComposerAgentControlsMenu = memo(function ComposerAgentControlsMenu(
  props: AgentControlsBinding & {
    size?: "sm" | "xs";
    hidden?: boolean;
  },
) {
  const size = props.size ?? "sm";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const restricted = isStudioRestricted(props.controls);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            className="shrink-0"
            aria-label="Agent controls"
            data-agent-controls-restricted={restricted ? "true" : undefined}
          />
        }
      >
        <ComposerControlIcon icon={SlidersHorizontalIcon} size={size} />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          Agent
        </span>
        {restricted ? (
          <span className="size-1.5 shrink-0 rounded-full bg-(--brand-accent)" aria-hidden />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        <AgentControlsMenuContent
          environmentId={props.environmentId}
          controls={props.controls}
          onChange={props.onChange}
        />
      </MenuPopup>
    </Menu>
  );
});
