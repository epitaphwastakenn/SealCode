import type * as Electron from "electron";

// Windows 11 draws the main window's system backdrop behind its transparent web
// contents. Acrylic flickers while the window covers the whole display
// (fullscreen always, maximized now and then); Mica does not. Floating panels
// leave the desktop showing between the panels, so they use no material. A
// window only renders acrylic when it was created with it, so the main window
// always starts on acrylic and switches from there.
export type WindowsBackdropMaterial = "acrylic" | "mica" | "none";

export function resolveWindowsBackdropMaterial(state: {
  readonly floatingPanels: boolean;
  readonly fillsDisplay: boolean;
}): WindowsBackdropMaterial {
  if (state.floatingPanels) return "none";
  return state.fillsDisplay ? "mica" : "acrylic";
}

const floatingPanelsByWindow = new WeakMap<Electron.BrowserWindow, boolean>();
const appliedMaterialByWindow = new WeakMap<Electron.BrowserWindow, WindowsBackdropMaterial>();

export function applyWindowsBackdrop(window: Electron.BrowserWindow): void {
  if (window.isDestroyed()) return;
  const material = resolveWindowsBackdropMaterial({
    floatingPanels: floatingPanelsByWindow.get(window) ?? false,
    fillsDisplay: window.isFullScreen() || window.isMaximized(),
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
const DWMWCP_ROUND = 2;

let roundCornersPromise: Promise<(windowHandle: bigint) => void> | undefined;

// Chromium opts transparent windows out of Windows 11's rounded corners. Asking
// DWM for them again keeps the acrylic and rounds the frame like any other app.
export function roundWindowsCorners(window: Electron.BrowserWindow): void {
  if (window.isDestroyed()) return;
  const windowHandle = window.getNativeWindowHandle().readBigUInt64LE(0);
  roundCornersPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const dwmapi = "t3-dwmapi";
    open({ library: dwmapi, path: "dwmapi.dll" });
    return (handle: bigint) => {
      const preference = Buffer.alloc(4);
      preference.writeUInt32LE(DWMWCP_ROUND);
      load({
        library: dwmapi,
        funcName: "DwmSetWindowAttribute",
        retType: DataType.I32,
        paramsType: [DataType.BigInt, DataType.U32, DataType.U8Array, DataType.U32],
        paramsValue: [handle, DWMWA_WINDOW_CORNER_PREFERENCE, preference, preference.byteLength],
      });
    };
  });
  // Windows 10 rejects the attribute; square corners are its native look anyway.
  void roundCornersPromise.then((round) => round(windowHandle)).catch(() => undefined);
}
