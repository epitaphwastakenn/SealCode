import type { DesktopWindowControlAction, DesktopWindowControlsState } from "@t3tools/contracts";
import type * as Electron from "electron";

import { WINDOW_CONTROLS_STATE_CHANNEL } from "../ipc/channels.ts";

// Electron's native caption buttons (titleBarOverlay) sit flush with the
// window's top-right edge, so their hover fill lands in the gap around floating
// panels. They cannot be moved, and a window cannot gain or lose them after it
// is created. A window created with floating panels on leaves them out and the
// renderer draws its own inside the panel. The window keeps that choice until
// the next launch.
const windowsWithAppCaptionButtons = new WeakSet<Electron.BrowserWindow>();

export function drawsAppCaptionButtons(window: Electron.BrowserWindow): boolean {
  return windowsWithAppCaptionButtons.has(window);
}

export function getAppCaptionButtonsState(
  window: Electron.BrowserWindow,
): DesktopWindowControlsState | null {
  if (window.isDestroyed() || !windowsWithAppCaptionButtons.has(window)) return null;
  return { maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
}

export function enableAppCaptionButtons(window: Electron.BrowserWindow): void {
  windowsWithAppCaptionButtons.add(window);
  const sendState = () => {
    const state = getAppCaptionButtonsState(window);
    if (state !== null) window.webContents.send(WINDOW_CONTROLS_STATE_CHANNEL, state);
  };
  window.on("maximize", sendState);
  window.on("unmaximize", sendState);
  window.on("enter-full-screen", sendState);
  window.on("leave-full-screen", sendState);
}

export function runWindowControl(
  window: Electron.BrowserWindow,
  action: DesktopWindowControlAction,
): void {
  if (window.isDestroyed()) return;
  if (action === "minimize") window.minimize();
  else if (action === "close") window.close();
  else if (window.isMaximized()) window.unmaximize();
  else window.maximize();
}
