import * as NodeEvents from "node:events";

import type * as Electron from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWA_BORDER_COLOR = 34;
const DWMWCP_DONOTROUND = 1;
const DWMWCP_ROUND = 2;
const DWMWA_COLOR_NONE = 0xfffffffe;
const DWMWA_COLOR_DEFAULT = 0xffffffff;

const attributeWrites = vi.hoisted((): Array<[number, number]> => []);

vi.mock("ffi-rs", () => ({
  DataType: {},
  open: () => undefined,
  load: ({ paramsValue }: { paramsValue: [bigint, number, Buffer, number] }) => {
    attributeWrites.push([paramsValue[1], paramsValue[2].readUInt32LE(0)]);
  },
}));

import {
  resolveWindowsBackdropMaterial,
  setWindowsFloatingPanels,
  trackWindowsDisplayFill,
} from "./WindowsBackdrop.ts";

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

async function takeFrames() {
  await vi.dynamicImportSettled();
  const frames: Array<{ corners: number; border: number }> = [];
  for (let index = 0; index < attributeWrites.length; index += 2) {
    expect(attributeWrites[index]?.[0]).toBe(DWMWA_WINDOW_CORNER_PREFERENCE);
    expect(attributeWrites[index + 1]?.[0]).toBe(DWMWA_BORDER_COLOR);
    frames.push({ corners: attributeWrites[index]![1], border: attributeWrites[index + 1]![1] });
  }
  attributeWrites.length = 0;
  return frames;
}

const rounded = { corners: DWMWCP_ROUND, border: DWMWA_COLOR_DEFAULT };
const square = { corners: DWMWCP_DONOTROUND, border: DWMWA_COLOR_DEFAULT };
const invisible = { corners: DWMWCP_DONOTROUND, border: DWMWA_COLOR_NONE };

describe("trackWindowsDisplayFill", () => {
  it("squares the corners while the window fills the display and rounds them after", async () => {
    await takeFrames();
    const fake = makeFakeWindow();
    setWindowsFloatingPanels(fake.window, false);
    trackWindowsDisplayFill(fake.window);

    // The launch maximize lands after the window exists.
    fake.state.maximized = true;
    fake.emit("maximize");
    expect(await takeFrames()).toEqual([rounded, square]);

    // Minimizing reports unmaximized, which must not round a window that comes back maximized.
    fake.state.minimized = true;
    fake.emit("resize");
    fake.state.minimized = false;
    fake.emit("restore");
    expect(await takeFrames()).toEqual([]);

    fake.state.maximized = false;
    fake.emit("unmaximize");
    fake.state.fullscreen = true;
    fake.emit("enter-full-screen");
    fake.state.fullscreen = false;
    fake.emit("leave-full-screen");
    expect(await takeFrames()).toEqual([rounded, square, rounded]);
    expect(fake.materials).toEqual(["acrylic", "mica", "acrylic", "mica", "acrylic"]);
  });

  it("keeps the window rectangle unrounded and unoutlined behind floating panels", async () => {
    await takeFrames();
    const fake = makeFakeWindow();
    setWindowsFloatingPanels(fake.window, true);
    trackWindowsDisplayFill(fake.window);
    fake.state.fullscreen = true;
    fake.emit("enter-full-screen");
    fake.state.fullscreen = false;
    fake.emit("leave-full-screen");
    expect(await takeFrames()).toEqual([invisible]);
    expect(fake.materials).toEqual(["none", "mica", "none"]);

    setWindowsFloatingPanels(fake.window, false);
    expect(await takeFrames()).toEqual([rounded]);
  });
});
