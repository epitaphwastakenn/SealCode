import { describe, expect, it } from "vite-plus/test";

import { resolveWindowsBackdropMaterial } from "./WindowsBackdrop.ts";

describe("resolveWindowsBackdropMaterial", () => {
  it("keeps acrylic for a normal window", () => {
    expect(resolveWindowsBackdropMaterial({ floatingPanels: false, fillsDisplay: false })).toBe(
      "acrylic",
    );
  });

  it("swaps to mica while the window fills the display, where acrylic flickers", () => {
    expect(resolveWindowsBackdropMaterial({ floatingPanels: false, fillsDisplay: true })).toBe(
      "mica",
    );
  });

  it("drops the material for floating panels in every window state", () => {
    expect(resolveWindowsBackdropMaterial({ floatingPanels: true, fillsDisplay: false })).toBe(
      "none",
    );
    expect(resolveWindowsBackdropMaterial({ floatingPanels: true, fillsDisplay: true })).toBe(
      "none",
    );
  });
});
