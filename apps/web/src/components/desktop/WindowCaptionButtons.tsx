import type { DesktopWindowControlAction } from "@t3tools/contracts";

import { useAppCaptionButtonsState } from "~/lib/windowControlsOverlay";

// The glyphs Windows draws in its own title bars. Segoe Fluent Icons (Windows
// 11) and Segoe MDL2 Assets (Windows 10) share these code points.
const MINIMIZE_GLYPH = "";
const MAXIMIZE_GLYPH = "";
const RESTORE_GLYPH = "";
const CLOSE_GLYPH = "";

function runWindowControl(action: DesktopWindowControlAction) {
  void window.desktopBridge?.runWindowControl?.(action);
}

/**
 * Minimize, maximize and close for a desktop window created without native
 * caption buttons (floating panels on Windows). index.css places them inside
 * the main panel's top-right corner.
 */
export function WindowCaptionButtons() {
  const state = useAppCaptionButtonsState();
  if (state === null || state.fullscreen) return null;

  const maximizeLabel = state.maximized ? "Restore" : "Maximize";
  return (
    <div data-window-caption-buttons="" role="group" aria-label="Window controls">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Minimize"
        onClick={() => runWindowControl("minimize")}
      >
        {MINIMIZE_GLYPH}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={maximizeLabel}
        onClick={() => runWindowControl("toggle-maximize")}
      >
        {state.maximized ? RESTORE_GLYPH : MAXIMIZE_GLYPH}
      </button>
      <button
        type="button"
        tabIndex={-1}
        data-close=""
        aria-label="Close"
        onClick={() => runWindowControl("close")}
      >
        {CLOSE_GLYPH}
      </button>
    </div>
  );
}
