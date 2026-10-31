import type { AgentPreset } from "@t3tools/contracts";
import { LayersIcon } from "lucide-react";
import { memo } from "react";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ComposerControl, ComposerControlChevron, ComposerControlIcon } from "./ComposerControl";
import type { ComposerControlSize } from "./ComposerControl";

export const AgentPresetPicker = memo(function AgentPresetPicker(props: {
  readonly presets: ReadonlyArray<AgentPreset>;
  readonly onSelect: (preset: AgentPreset) => void;
  readonly size?: ComposerControlSize;
  readonly compact?: boolean;
}) {
  if (props.presets.length === 0) return null;
  const size = props.size ?? (props.compact ? "xs" : "sm");

  return (
    <Menu>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            aria-label="Apply agent workflow preset"
            className={props.compact ? "max-w-32 shrink-0" : "max-w-44 shrink-0"}
          />
        }
      >
        <ComposerControlIcon icon={LayersIcon} size={size} />
        <span data-composer-control-label className="truncate">
          Preset
        </span>
        <ComposerControlChevron size={size} />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-64">
        <MenuGroup>
          <MenuGroupLabel>Workflow presets</MenuGroupLabel>
          {props.presets.map((preset) => (
            <MenuItem key={preset.id} onClick={() => props.onSelect(preset)}>
              <div className="min-w-0">
                <div className="truncate">{preset.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {preset.modelSelection.model}
                </div>
              </div>
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});
