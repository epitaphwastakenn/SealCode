// @effect-diagnostics globalDate:off -- Names a one-off animation in an Electron callback.
import type { ComputerUseGrant } from "@t3tools/contracts";
import * as Electron from "electron";

import { SnapShotTransition } from "../snapShot/SnapShotTransition.ts";

const OVERLAY_WIDTH = 380;
const OVERLAY_HEIGHT = 56;
const OVERLAY_MARGIN = 16;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

const palette = () =>
  Electron.nativeTheme.shouldUseDarkColors
    ? {
        background: "#18181b",
        border: "#3f3f46",
        text: "#fafafa",
        muted: "#a1a1aa",
        accent: "#f97316",
      }
    : {
        background: "#ffffff",
        border: "#e4e4e7",
        text: "#18181b",
        muted: "#71717a",
        accent: "#ea580c",
      };

const page = (body: string, script: string) => {
  const colors = palette();
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:${Electron.nativeTheme.shouldUseDarkColors ? "dark" : "light"}}
*{box-sizing:border-box;margin:0}
html,body{height:100%;background:transparent;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:${colors.text};user-select:none}
.card{height:100%;background:${colors.background};border:1px solid ${colors.border};border-radius:12px;overflow:hidden}
.muted{color:${colors.muted}}
button{font:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;border:1px solid ${colors.border};background:transparent;color:${colors.text}}
button.primary{background:${colors.accent};border-color:${colors.accent};color:#fff}
.dot{width:8px;height:8px;border-radius:50%;background:${colors.accent};flex:none}
</style></head><body>${body}<script>${script}</script></body></html>`)}`;
};

/**
 * Shown while an agent drives the computer. It never takes focus, so the app
 * the agent is typing into keeps it, and content protection keeps it out of
 * the agent's screenshots.
 */
export class ComputerUseOverlay {
  private window: Electron.BrowserWindow | undefined;
  private readonly transition = new SnapShotTransition({ alwaysOnTopLevel: "screen-saver" });
  private readonly onStop: () => void;

  constructor(onStop: () => void) {
    this.onStop = onStop;
  }

  get isShown(): boolean {
    return this.window !== undefined && !this.window.isDestroyed();
  }

  private bounds(): Electron.Rectangle {
    const area = Electron.screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + area.width - OVERLAY_WIDTH - OVERLAY_MARGIN,
      y: area.y + area.height - OVERLAY_HEIGHT - OVERLAY_MARGIN,
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
    };
  }

  async show(agentName: string, main: Electron.BrowserWindow | undefined): Promise<void> {
    if (this.isShown) return;
    const bounds = this.bounds();
    const window = new Electron.BrowserWindow({
      ...bounds,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      focusable: false,
      frame: false,
      hasShadow: true,
      resizable: false,
      movable: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      title: "Harp Computer Use",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setContentProtection(true);
    this.window = window;
    await window.loadURL(
      page(
        `<div class="card" style="display:flex;align-items:center;gap:10px;padding:0 10px 0 14px">
          <span class="dot"></span>
          <div style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escapeHtml(agentName)} is using your computer
          </div>
          <button id="stop">Stop <span class="muted">Esc</span></button>
        </div>`,
        `window.__stop = new Promise((resolve) => document.getElementById("stop").onclick = () => resolve(true));`,
      ),
    );
    void window.webContents
      .executeJavaScript("window.__stop", true)
      .then(() => this.onStop())
      .catch(() => undefined);

    if (main && !main.isDestroyed() && main.isVisible() && !main.isMinimized()) {
      await this.shrink(main, bounds).catch(() => main.hide());
    } else {
      main?.hide();
    }
    if (!window.isDestroyed()) window.showInactive();
  }

  private async shrink(main: Electron.BrowserWindow, to: Electron.Rectangle): Promise<void> {
    const id = `computer-use-${Date.now()}`;
    const snapshot = await main.webContents.capturePage();
    await this.transition.begin(id, main.getBounds(), snapshot.toDataURL(), false, to);
    main.hide();
    const colors = palette();
    this.transition.animateTo(id, {
      frame: to,
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      cornerRadius: 12,
      scaleFactor: Electron.screen.getDisplayMatching(to).scaleFactor,
    });
    await this.transition.complete(id);
  }

  /** Lets an agent click land on whatever sits beneath the overlay. */
  passThrough(enabled: boolean): void {
    if (this.isShown) this.window!.setIgnoreMouseEvents(enabled);
  }

  hide(main: Electron.BrowserWindow | undefined): void {
    this.transition.dispose();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
    if (main && !main.isDestroyed()) {
      main.show();
      main.focus();
    }
  }
}

const TIER_LABELS: Readonly<Record<ComputerUseGrant["tier"], string>> = {
  full: "Full access",
  click: "Clicks only (terminal/IDE)",
  read: "View only (browser)",
};

/** Asks the person at this computer; resolves false when they deny or close the dialog. */
export async function askForComputerAccess(input: {
  readonly parent: Electron.BrowserWindow | undefined;
  readonly agentName: string;
  readonly grants: ReadonlyArray<ComputerUseGrant>;
  readonly reason: string | undefined;
}): Promise<boolean> {
  const height = 190 + input.grants.length * 34 + (input.reason ? 40 : 0);
  const parent = input.parent && !input.parent.isDestroyed() ? input.parent : undefined;
  const window = new Electron.BrowserWindow({
    width: 440,
    height: Math.min(height, 620),
    ...(parent ? { parent } : {}),
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: false,
    transparent: true,
    title: "Allow computer use",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setContentProtection(true);
  window.center();
  const rows = input.grants
    .map(
      (grant) =>
        `<li style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line)">
          <strong>${escapeHtml(grant.app)}</strong><span class="muted">${TIER_LABELS[grant.tier]}</span>
        </li>`,
    )
    .join("");
  try {
    await window.loadURL(
      page(
        `<div class="card" style="--line:${palette().border};display:flex;flex-direction:column;gap:12px;padding:18px">
          <div style="font-size:15px;font-weight:600">${escapeHtml(input.agentName)} wants to use these apps</div>
          ${input.reason ? `<div class="muted">${escapeHtml(input.reason)}</div>` : ""}
          <ul style="list-style:none;padding:0;flex:1;overflow:auto">${rows}</ul>
          <div class="muted" style="font-size:12px">Harp shrinks to a small panel while the agent works. Press Esc to stop it.</div>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="deny">Deny</button><button id="allow" class="primary">Allow</button>
          </div>
        </div>`,
        `window.__decision = new Promise((resolve) => {
          document.getElementById("allow").onclick = () => resolve(true);
          document.getElementById("deny").onclick = () => resolve(false);
          addEventListener("keydown", (event) => { if (event.key === "Escape") resolve(false); });
        });`,
      ),
    );
    window.show();
    window.focus();
    const closed = new Promise<boolean>((resolve) => window.once("closed", () => resolve(false)));
    const decided = window.webContents
      .executeJavaScript("window.__decision", true)
      .then((value) => value === true);
    return await Promise.race([decided, closed]);
  } catch {
    return false;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
