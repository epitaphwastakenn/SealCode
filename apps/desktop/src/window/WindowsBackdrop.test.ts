import * as NodeEvents from "node:events";

import type * as Electron from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

const cornerPreferences = vi.hoisted((): number[] => []);

vi.mock("ffi-rs", () => ({
  DataType: {},
  open: () => undefined,
  load: ({ paramsValue }: { paramsValue: [bigint, number, Buffer, number] }) => {
    cornerPreferences.push(paramsValue[2].readUInt32LE(0));
  },
}));

import {
  resolveWindowsBackdropMaterial,
  setWindowsFloatingPanels,
  trackWindowsDisplayFill,
} from "./WindowsBackdrop.ts";

const DWMWCP_DONOTROUND = 1;
const DWMWCP_ROUND = 2;

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

  it("drops the material for floating panels until the window fills the display", () => {
    expect(resolveWindowsBackdropMaterial({ floatingPanels: true, fillsDisplay: false })).toBe(
      "none",
    );
    expect(resolveWindowsBackdropMaterial({ floatingPanels: true, fillsDisplay: true })).toBe(
      "mica",
    );
  });
});

function makeFakeWindow() {
  const events = new NodeEvents.EventEmitter();
  const state = { maximized: false, fullscreen: false, minimized: false };
  const materials: string[] = [];
  const window = {
    on: (event: string, listener: () => void) => events.on(event, listener),
    isDestroyed: () => false,
    isMaximized: () => state.maximized && !state.minimized,
    isFullScreen: () => state.fullscreen,
    isMinimized: () => state.minimized,
    getNativeWindowHandle: () => Buffer.alloc(8),
    setBackgroundMaterial: (material: string) => materials.push(material),
    setBackgroundColor: () => undefined,
  };
  return {
    window: window as unknown as Electron.BrowserWindow,
    state,
    materials,
    emit: (event: string) => events.emit(event),
  };
}

const flushCornerPreference = () => vi.dynamicImportSettled();

describe("trackWindowsDisplayFill", () => {
  it("squares the corners while the window fills the display and rounds them after", async () => {
    cornerPreferences.length = 0;
    const fake = makeFakeWindow();
    setWindowsFloatingPanels(fake.window, true);
    trackWindowsDisplayFill(fake.window);

    // The launch maximize lands after the window exists.
    fake.state.maximized = true;
    fake.emit("maximize");
    await flushCornerPreference();
    expect(cornerPreferences).toEqual([DWMWCP_ROUND, DWMWCP_DONOTROUND]);
    expect(fake.materials).toEqual(["none", "mica"]);

    // Minimizing reports unmaximized, which must not round a window that comes back maximized.
    fake.state.minimized = true;
    fake.emit("resize");
    fake.state.minimized = false;
    fake.emit("restore");
    await flushCornerPreference();
    expect(cornerPreferences).toEqual([DWMWCP_ROUND, DWMWCP_DONOTROUND]);

    fake.state.maximized = false;
    fake.emit("unmaximize");
    fake.state.fullscreen = true;
    fake.emit("enter-full-screen");
    fake.state.fullscreen = false;
    fake.emit("leave-full-screen");
    await flushCornerPreference();
    expect(cornerPreferences).toEqual([
      DWMWCP_ROUND,
      DWMWCP_DONOTROUND,
      DWMWCP_ROUND,
      DWMWCP_DONOTROUND,
      DWMWCP_ROUND,
    ]);
    expect(fake.materials).toEqual(["none", "mica", "none", "mica", "none"]);
  });
});
