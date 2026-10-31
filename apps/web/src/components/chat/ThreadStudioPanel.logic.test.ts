import { describe, expect, it } from "vite-plus/test";

import { studioPlaceChange, studioPlaceDetail, studioPlaceRows } from "./ThreadStudioPanel.logic";

const edit = (instanceId: string, placeName: string, placeKey = instanceId) => ({
  instanceId,
  placeKey,
  role: "edit",
  placeName,
  isRunning: false,
});

describe("studioPlaceRows", () => {
  it("groups a place's peers into one row and marks a running playtest", () => {
    const rows = studioPlaceRows(
      [
        edit("place:1", "Lobby"),
        { instanceId: "place:1", placeKey: "place:1", role: "server", isRunning: true },
        edit("anon:b", "Arena"),
      ],
      undefined,
    );
    expect(rows.map((row) => [row.name, row.included, row.playtestRunning])).toEqual([
      ["Arena", true, false],
      ["Lobby", true, true],
    ]);
  });

  it("keeps a turned-off place that is not connected so it can be turned back on", () => {
    const rows = studioPlaceRows([edit("place:1", "Lobby")], {
      excludedPlaces: [
        { placeKey: "place:1", placeName: "Lobby" },
        { placeKey: "anon:gone", placeName: "Old" },
      ],
    });
    expect(rows.map((row) => [row.name, row.included, row.connected])).toEqual([
      ["Lobby", false, true],
      ["Old", false, false],
    ]);
    expect(studioPlaceDetail(rows[1]!)).toBe("Not connected");
    expect(studioPlaceDetail(rows[0]!)).toBe("Ignored by the agent");
  });

  it("builds the change that flips a row", () => {
    const [row] = studioPlaceRows([edit("place:1", "Lobby")], undefined);
    expect(studioPlaceChange(row!, false)).toEqual({
      excludePlaces: [{ placeKey: "place:1", placeName: "Lobby" }],
    });
    expect(studioPlaceChange(row!, true)).toEqual({ includePlaces: ["place:1"] });
  });
});
