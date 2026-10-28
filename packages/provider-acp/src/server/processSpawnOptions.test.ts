import { describe, expect, it } from "vite-plus/test";

import { ownedProcessSpawnOptions } from "./processSpawnOptions.ts";

describe("ownedProcessSpawnOptions", () => {
  it("keeps Windows agents attached to a hidden console so their tools open no windows", () => {
    expect(ownedProcessSpawnOptions(true, "win32")).toEqual({ detached: false, windowsHide: true });
  });

  it("still detaches POSIX agents into their own process group", () => {
    expect(ownedProcessSpawnOptions(true, "linux")).toEqual({ detached: true, windowsHide: true });
    expect(ownedProcessSpawnOptions(true, "darwin")).toEqual({ detached: true, windowsHide: true });
  });

  it("leaves spawn options alone when the runtime does not own the tree", () => {
    expect(ownedProcessSpawnOptions(undefined, "win32")).toEqual({});
  });
});
