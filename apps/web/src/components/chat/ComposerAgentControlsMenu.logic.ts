import type { OrchestrationV2StudioControls, RobloxStudioPlace } from "@t3tools/contracts";
import { playtestsAllowed, type StudioControlsChange } from "@t3tools/shared/studioControls";

import { studioPlaceChange, studioPlaceDetail, studioPlaceRows } from "./ThreadStudioPanel.logic";

export interface AgentControlItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

export interface AgentControlGroup {
  readonly id: string;
  readonly label: string;
  readonly items: ReadonlyArray<AgentControlItem>;
  readonly emptyHint?: string;
}

export function agentControlGroups(input: {
  readonly controls: OrchestrationV2StudioControls | null | undefined;
  readonly places: ReadonlyArray<RobloxStudioPlace> | undefined;
  readonly onChange: (change: StudioControlsChange) => void;
}): ReadonlyArray<AgentControlGroup> {
  const rows = studioPlaceRows(input.places, input.controls);
  return [
    {
      id: "playtests",
      label: "Playtests",
      items: [
        {
          id: "allow-playtests",
          label: "Let the agent start playtests",
          detail: null,
          checked: playtestsAllowed(input.controls),
          onCheckedChange: (allowPlaytests) => input.onChange({ allowPlaytests }),
        },
      ],
    },
    {
      id: "studio-places",
      label: "Studio places",
      items: rows.map((row) => ({
        id: row.placeKey,
        label: row.name,
        detail: studioPlaceDetail(row),
        checked: row.included,
        onCheckedChange: (included) => input.onChange(studioPlaceChange(row, included)),
      })),
      emptyHint: "No Studio place is connected.",
    },
  ];
}
