import type { DesktopWindowControlsState } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { isElectron } from "~/env";

import { isMacPlatform, isWindowsPlatform } from "./utils";

const WCO_CLASS_NAME = "wco";
const APP_CAPTION_BUTTONS_CLASS_NAME = "app-caption-buttons";
const ELECTRON_CLASS_NAME = "electron";
const ELECTRON_WINDOWS_CLASS_NAME = "electron-windows";
// The workspace topbar the desktop app centers the traffic lights in. macOS has
// no overlay API to measure, and the lights stay inside it at any zoom level.
const MACOS_TITLEBAR_HEIGHT = 52;
// The overlay height the desktop app gives Windows windows (TITLEBAR_HEIGHT in
// DesktopWindow.ts), kept when the app draws the caption buttons itself.
const WINDOWS_TITLEBAR_HEIGHT = 40;

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

function getWindowControlsOverlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
}

// Set when the desktop window has no native caption buttons and the app draws
// them (see WindowCaptionButtons). Read once over sync IPC, then kept current
// by the desktop's state events.
let appCaptionButtonsState: DesktopWindowControlsState | null = null;
const appCaptionButtonsListeners = new Set<() => void>();

export function syncDocumentWindowControlsOverlayClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const overlay = getWindowControlsOverlay();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  appCaptionButtonsState = bridge?.getWindowControlsState?.() ?? null;
  const update = () => {
    // App-drawn buttons stand in for the overlay, so the layout reserves the
    // same corner for them. Both hide in fullscreen.
    const appButtons = appCaptionButtonsState !== null && !appCaptionButtonsState.fullscreen;
    const classList = document.documentElement.classList;
    classList.toggle(WCO_CLASS_NAME, (overlay !== null && overlay.visible) || appButtons);
    classList.toggle(APP_CAPTION_BUTTONS_CLASS_NAME, appButtons);
  };

  update();
  const unsubscribeAppButtons =
    appCaptionButtonsState === null
      ? undefined
      : bridge?.onWindowControlsStateChange?.((state) => {
          appCaptionButtonsState = state;
          update();
          for (const listener of appCaptionButtonsListeners) listener();
        });
  overlay?.addEventListener("geometrychange", update);
  return () => {
    unsubscribeAppButtons?.();
    overlay?.removeEventListener("geometrychange", update);
  };
}

function subscribeAppCaptionButtons(listener: () => void): () => void {
  appCaptionButtonsListeners.add(listener);
  return () => {
    appCaptionButtonsListeners.delete(listener);
  };
}

export function useAppCaptionButtonsState(): DesktopWindowControlsState | null {
  return useSyncExternalStore(
    subscribeAppCaptionButtons,
    () => appCaptionButtonsState,
    () => null,
  );
}

function subscribeTitlebarArea(listener: () => void): () => void {
  const overlay = getWindowControlsOverlay();
  overlay?.addEventListener("geometrychange", listener);
  const unsubscribeAppButtons = subscribeAppCaptionButtons(listener);
  return () => {
    overlay?.removeEventListener("geometrychange", listener);
    unsubscribeAppButtons();
  };
}

function getNativeTitlebarHeight(): number {
  if (isElectron && isMacPlatform(navigator.platform)) return MACOS_TITLEBAR_HEIGHT;
  if (appCaptionButtonsState !== null && !appCaptionButtonsState.fullscreen) {
    return WINDOWS_TITLEBAR_HEIGHT;
  }
  const overlay = getWindowControlsOverlay();
  return overlay?.visible ? overlay.getTitlebarAreaRect().bottom : 0;
}

export function useNativeTitlebarHeight(): number {
  return useSyncExternalStore(subscribeTitlebarArea, getNativeTitlebarHeight, () => 0);
}

function getElectronPlatformClassNames(
  platform: string,
):
  | readonly [typeof ELECTRON_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_WINDOWS_CLASS_NAME] {
  return isWindowsPlatform(platform)
    ? [ELECTRON_CLASS_NAME, ELECTRON_WINDOWS_CLASS_NAME]
    : [ELECTRON_CLASS_NAME];
}

export function syncDocumentElectronPlatformClasses(platform: string): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const classNames = getElectronPlatformClassNames(platform);
  document.documentElement.classList.add(...classNames);
  return () => {
    document.documentElement.classList.remove(...classNames);
  };
}
