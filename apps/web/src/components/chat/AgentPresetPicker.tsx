import type { AgentPreset } from "@t3tools/contracts";
import { BookmarkIcon, ChevronDownIcon } from "lucide-react";
import { memo } from "react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ComposerControl } from "./ComposerControl";

export const AgentPresetPicker = memo(function AgentPresetPicker(props: {
  readonly presets: ReadonlyArray<AgentPreset>;
  readonly onSelect: (preset: AgentPreset) => void;
  readonly compact?: boolean;
}) {
  if (props.presets.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <ComposerControl
            aria-label="Apply agent workflow preset"
            className={props.compact ? "max-w-32 shrink-0 px-1.5" : "max-w-44 shrink-0"}
          />
        }
      >
        <BookmarkIcon className="size-3.5 shrink-0" />
        <span className="truncate">Preset</span>
        <ChevronDownIcon className="size-3 shrink-0 text-icon-muted" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-64">
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Workflow presets
        </div>
        {props.presets.map((preset) => (
          <MenuItem key={preset.id} onClick={() => props.onSelect(preset)}>
            <div className="min-w-0">
              <div className="truncate font-medium">{preset.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {preset.kind} · {preset.modelSelection.model}
                {preset.skills.length > 0 ? ` · ${preset.skills.length} skills` : ""}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {preset.interactionMode}
              </div>
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
});
