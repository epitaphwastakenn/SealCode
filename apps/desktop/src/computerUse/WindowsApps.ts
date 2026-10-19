// @effect-diagnostics nodeBuiltinImport:off -- Launches apps and asks Windows about its windows with Node.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import type { ComputerUseAppIdentity } from "@t3tools/shared/computerUse";
import { computerUseGrantMatches } from "@t3tools/shared/computerUse";

import {
  activateWindowsForegroundWithApi,
  loadWindowsForegroundApi,
  type WindowsForegroundApi,
} from "../electron/WindowsForeground.ts";
import { VK_MENU } from "./keys.ts";
import { chordEvents, loadWindowsInputApi } from "./WindowsInput.ts";

export interface AppWindow extends ComputerUseAppIdentity {
  readonly hwnd: bigint;
  readonly processId: number;
  readonly path: string;
}

const GA_ROOT = 2;
const GW_HWNDNEXT = 2;
const GW_OWNER = 4;
const GW_CHILD = 5;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOWMINNOACTIVE = 7;
const SW_RESTORE = 9;
/** The desktop, taskbars and their helpers are shell surfaces, not apps to hide. */
const SHELL_WINDOW_CLASSES = new Set([
  "Progman",
  "WorkerW",
  "Shell_TrayWnd",
  "Shell_SecondaryTrayWnd",
  "Windows.UI.Core.CoreWindow",
]);

interface WindowsWindowApi {
  readonly windowFromPoint: (x: number, y: number) => bigint;
  readonly getAncestor: (hwnd: bigint, flags: number) => bigint;
  readonly getWindow: (hwnd: bigint, command: number) => bigint;
  readonly getDesktopWindow: () => bigint;
  readonly isWindowVisible: (hwnd: bigint) => boolean;
  readonly isIconic: (hwnd: bigint) => boolean;
  readonly getExtendedStyle: (hwnd: bigint) => bigint;
  readonly showWindow: (hwnd: bigint, command: number) => boolean;
}

let windowApiPromise: Promise<WindowsWindowApi> | undefined;

function loadWindowsWindowApi(): Promise<WindowsWindowApi> {
  windowApiPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const user32 = "t3-computer-use-windows";
    open({ library: user32, path: "user32.dll" });
    const handleAndNumber = (funcName: string, hwnd: bigint, value: number) =>
      load({
        library: user32,
        funcName,
        retType: DataType.BigInt,
        paramsType: [DataType.BigInt, DataType.U32],
        paramsValue: [hwnd, value],
      }) as bigint;
    const handlePredicate = (funcName: string, hwnd: bigint) =>
      load({
        library: user32,
        funcName,
        retType: DataType.Boolean,
        paramsType: [DataType.BigInt],
        paramsValue: [hwnd],
      });
    return {
      // POINT is passed by value; on x64 that is one 64-bit register, y in the high half.
      windowFromPoint: (x, y) =>
        load({
          library: user32,
          funcName: "WindowFromPoint",
          retType: DataType.BigInt,
          paramsType: [DataType.BigInt],
          paramsValue: [(BigInt(Math.round(y) >>> 0) << 32n) | BigInt(Math.round(x) >>> 0)],
        }) as bigint,
      getAncestor: (hwnd, flags) => handleAndNumber("GetAncestor", hwnd, flags),
      getWindow: (hwnd, command) => handleAndNumber("GetWindow", hwnd, command),
      getDesktopWindow: () =>
        load({
          library: user32,
          funcName: "GetDesktopWindow",
          retType: DataType.BigInt,
          paramsType: [],
          paramsValue: [],
        }) as bigint,
      isWindowVisible: (hwnd) => handlePredicate("IsWindowVisible", hwnd),
      isIconic: (hwnd) => handlePredicate("IsIconic", hwnd),
      getExtendedStyle: (hwnd) =>
        load({
          library: user32,
          funcName: "GetWindowLongPtrW",
          retType: DataType.BigInt,
          paramsType: [DataType.BigInt, DataType.I32],
          paramsValue: [hwnd, GWL_EXSTYLE],
        }) as bigint,
      showWindow: (hwnd, command) =>
        load({
          library: user32,
          funcName: "ShowWindow",
          retType: DataType.Boolean,
          paramsType: [DataType.BigInt, DataType.I32],
          paramsValue: [hwnd, command],
        }),
    };
  });
  return windowApiPromise;
}

const describeWindow = (api: WindowsForegroundApi, hwnd: bigint): AppWindow | undefined => {
  if (hwnd === 0n) return undefined;
  const { processId } = api.getWindowThreadAndProcessId(hwnd);
  if (processId === 0) return undefined;
  const path = api.getProcessImagePath(processId);
  return {
    hwnd,
    processId,
    path,
    exeName: path ? NodePath.win32.basename(path) : "",
    title: api.getWindowText(hwnd),
  };
};

export async function appWindowAtPoint(x: number, y: number): Promise<AppWindow | undefined> {
  const [windows, foreground] = await Promise.all([
    loadWindowsWindowApi(),
    loadWindowsForegroundApi(),
  ]);
  const hit = windows.windowFromPoint(x, y);
  return describeWindow(foreground, hit === 0n ? 0n : windows.getAncestor(hit, GA_ROOT));
}

export async function foregroundAppWindow(): Promise<AppWindow | undefined> {
  const api = await loadWindowsForegroundApi();
  return describeWindow(api, api.getForegroundWindow());
}

/** Top-level windows a person would call an app's window, front to back. */
export async function listAppWindows(): Promise<ReadonlyArray<AppWindow>> {
  const [windows, foreground] = await Promise.all([
    loadWindowsWindowApi(),
    loadWindowsForegroundApi(),
  ]);
  const result: AppWindow[] = [];
  let hwnd = windows.getWindow(windows.getDesktopWindow(), GW_CHILD);
  for (let guard = 0; hwnd !== 0n && guard < 4096; guard += 1) {
    const isAppWindow =
      windows.isWindowVisible(hwnd) &&
      windows.getWindow(hwnd, GW_OWNER) === 0n &&
      (windows.getExtendedStyle(hwnd) & BigInt(WS_EX_TOOLWINDOW)) === 0n &&
      !SHELL_WINDOW_CLASSES.has(foreground.getWindowClassName(hwnd)) &&
      foreground.getWindowText(hwnd).trim().length > 0;
    if (isAppWindow) {
      const described = describeWindow(foreground, hwnd);
      if (described) result.push(described);
    }
    hwnd = windows.getWindow(hwnd, GW_HWNDNEXT);
  }
  return result;
}

export async function isMinimized(hwnd: bigint): Promise<boolean> {
  return (await loadWindowsWindowApi()).isIconic(hwnd);
}

export async function minimizeWithoutFocus(hwnd: bigint): Promise<void> {
  (await loadWindowsWindowApi()).showWindow(hwnd, SW_SHOWMINNOACTIVE);
}

export async function restoreWithoutFocus(hwnd: bigint): Promise<void> {
  (await loadWindowsWindowApi()).showWindow(hwnd, SW_SHOWNOACTIVATE);
}

const handleBuffer = (hwnd: bigint) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(hwnd);
  return buffer;
};

export async function bringToFront(hwnd: bigint): Promise<boolean> {
  const [windows, foreground] = await Promise.all([
    loadWindowsWindowApi(),
    loadWindowsForegroundApi(),
  ]);
  if (windows.isIconic(hwnd)) windows.showWindow(hwnd, SW_RESTORE);
  if (activateWindowsForegroundWithApi(handleBuffer(hwnd), foreground)) return true;
  // Windows only lets the process that last received input take the foreground;
  // a synthetic Alt tap makes this process that one.
  (await loadWindowsInputApi()).send(
    chordEvents({ modifiers: [], key: { kind: "vk", key: VK_MENU } }),
  );
  return activateWindowsForegroundWithApi(handleBuffer(hwnd), foreground);
}

export async function findAppWindow(appName: string): Promise<AppWindow | undefined> {
  return (await listAppWindows()).find((window) => computerUseGrantMatches(appName, window));
}

interface StartApp {
  readonly Name: string;
  readonly AppID: string;
}

let startAppsPromise: Promise<ReadonlyArray<StartApp>> | undefined;

/** `Get-StartApps` lists Store apps (the new Paint, Calculator) beside classic shortcuts. */
function startApps(): Promise<ReadonlyArray<StartApp>> {
  startAppsPromise ??= new Promise((resolve) => {
    NodeChildProcess.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-StartApps | ConvertTo-Json -Compress"],
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          startAppsPromise = undefined;
          resolve([]);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve(
            list.filter(
              (entry): entry is StartApp =>
                typeof entry?.Name === "string" && typeof entry?.AppID === "string",
            ),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });
  return startAppsPromise;
}

const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/gu, "");

export async function launchApp(appName: string): Promise<string> {
  const wanted = normalized(appName);
  const apps = await startApps();
  const match =
    apps.find((app) => normalized(app.Name) === wanted) ??
    apps.find((app) => normalized(app.Name).startsWith(wanted)) ??
    apps.find((app) => normalized(app.Name).includes(wanted));
  const [command, args] = match
    ? ["explorer.exe", [`shell:AppsFolder\\${match.AppID}`]]
    : // `start` resolves App Paths entries such as mspaint or notepad.
      ["cmd.exe", ["/d", "/c", "start", '""', appName]];
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return match?.Name ?? appName;
}
