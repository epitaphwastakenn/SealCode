import type * as Electron from "electron";

// Windows 11 draws the main window's system backdrop behind its transparent web
// contents. Acrylic flickers while the window covers the whole display
// (fullscreen always, maximized now and then); Mica does not. Floating panels
// leave the desktop showing between the panels, so a normal window with them
// uses no material. Once the window fills the display, Mica fills those gaps so
// whatever sits under the window never shows. A window only renders acrylic
// when it was created with it, so the main window always starts on acrylic and
// switches from there.
export type WindowsBackdropMaterial = "acrylic" | "mica" | "none";

export function resolveWindowsBackdropMaterial(state: {
  readonly floatingPanels: boolean;
  readonly fillsDisplay: boolean;
}): WindowsBackdropMaterial {
  if (state.fillsDisplay) return "mica";
  return state.floatingPanels ? "none" : "acrylic";
}

function fillsDisplay(window: Electron.BrowserWindow): boolean {
  return window.isFullScreen() || window.isMaximized();
}

const floatingPanelsByWindow = new WeakMap<Electron.BrowserWindow, boolean>();
const appliedMaterialByWindow = new WeakMap<Electron.BrowserWindow, WindowsBackdropMaterial>();

export function applyWindowsBackdrop(window: Electron.BrowserWindow): void {
  // A minimized window reports itself unmaximized; restoring it applies again.
  if (window.isDestroyed() || window.isMinimized()) return;
  const material = resolveWindowsBackdropMaterial({
    floatingPanels: floatingPanelsByWindow.get(window) ?? false,
    fillsDisplay: fillsDisplay(window),
  });
  if (appliedMaterialByWindow.get(window) === material) return;
  appliedMaterialByWindow.set(window, material);
  window.setBackgroundMaterial(material);
  // Dropping the material repaints the window background opaque white unless
  // the transparent color is set again afterwards.
  window.setBackgroundColor("#00000000");
}

export function setWindowsFloatingPanels(window: Electron.BrowserWindow, enabled: boolean): void {
  floatingPanelsByWindow.set(window, enabled);
  applyWindowsBackdrop(window);
}

const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_DONOTROUND = 1;
const DWMWCP_ROUND = 2;

export function resolveWindowsCornerPreference(state: { readonly fillsDisplay: boolean }): number {
  return state.fillsDisplay ? DWMWCP_DONOTROUND : DWMWCP_ROUND;
}

let setCornerPreferencePromise:
  | Promise<(windowHandle: bigint, preference: number) => void>
  | undefined;
const appliedCornerPreferenceByWindow = new WeakMap<Electron.BrowserWindow, number>();

// Chromium opts transparent windows out of Windows 11's rounded corners. Asking
// DWM for them again keeps the acrylic and rounds the frame like any other app.
// Electron maximizes a transparent window by resizing it to the work area, so
// DWM never sees it maximized and keeps rounding it, which shows what is behind
// the window in the screen corners; fullscreen does the same. The corners go
// square while the window fills the display.
function syncWindowsCorners(window: Electron.BrowserWindow): void {
  const preference = resolveWindowsCornerPreference({ fillsDisplay: fillsDisplay(window) });
  if (appliedCornerPreferenceByWindow.get(window) === preference) return;
  appliedCornerPreferenceByWindow.set(window, preference);
  const windowHandle = window.getNativeWindowHandle().readBigUInt64LE(0);
  setCornerPreferencePromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const dwmapi = "t3-dwmapi";
    open({ library: dwmapi, path: "dwmapi.dll" });
    return (handle: bigint, value: number) => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32LE(value);
      load({
        library: dwmapi,
        funcName: "DwmSetWindowAttribute",
        retType: DataType.I32,
        paramsType: [DataType.BigInt, DataType.U32, DataType.U8Array, DataType.U32],
        paramsValue: [handle, DWMWA_WINDOW_CORNER_PREFERENCE, buffer, buffer.byteLength],
      });
    };
  });
  // Callbacks on one promise run in call order, so the latest state wins.
  // Windows 10 rejects the attribute; square corners are its native look anyway.
  void setCornerPreferencePromise
    .then((setPreference) => setPreference(windowHandle, preference))
    .catch(() => undefined);
}

// Every way into or out of filling the display lands here: the caption button,
// a title bar double click, Win+Up, F11, a restore from the taskbar and the
// maximize applied at launch. Electron's maximize of a transparent window is a
// resize, so "resize" also catches snaps that size the window to the work area.
export function trackWindowsDisplayFill(window: Electron.BrowserWindow): void {
  const sync = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    applyWindowsBackdrop(window);
    syncWindowsCorners(window);
  };
  window.on("maximize", sync);
  window.on("unmaximize", sync);
  window.on("enter-full-screen", sync);
  window.on("leave-full-screen", sync);
  window.on("restore", sync);
  window.on("resize", sync);
  sync();
}
