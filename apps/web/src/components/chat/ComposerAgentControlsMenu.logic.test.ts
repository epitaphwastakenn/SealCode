import { describe, expect, it, vi } from "vite-plus/test";

import { agentControlGroups } from "./ComposerAgentControlsMenu.logic";

describe("agentControlGroups", () => {
  it("lists the playtest switch and one switch per place, and sends the matching change", () => {
    const onChange = vi.fn();
    const groups = agentControlGroups({
      controls: { allowPlaytests: false },
      places: [{ instanceId: "place:1", placeKey: "place:1", role: "edit", placeName: "Lobby" }],
      onChange,
    });
    expect(groups.map((group) => group.id)).toEqual(["playtests", "studio-places"]);
    const playtests = groups[0]!.items[0]!;
    expect(playtests.checked).toBe(false);
    playtests.onCheckedChange(true);
    expect(onChange).toHaveBeenLastCalledWith({ allowPlaytests: true });
    const place = groups[1]!.items[0]!;
    expect([place.label, place.checked]).toEqual(["Lobby", true]);
    place.onCheckedChange(false);
    expect(onChange).toHaveBeenLastCalledWith({
      excludePlaces: [{ placeKey: "place:1", placeName: "Lobby" }],
    });
  });
});
