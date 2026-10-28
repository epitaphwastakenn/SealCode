// @effect-diagnostics globalTimers:off -- Capture timeouts and Electron overlay animation timers run at native callback boundaries outside Effect fibers.

import {
  DEFAULT_CLIENT_SETTINGS,
  DesktopPendingSnapShot,
  isModifierPairShortcut,
  snapShotModifierPairLabel,
  snapShotShortcutModifierPair,
  type DesktopSnapShot as DesktopSnapShotValue,
  type DesktopSnapShotShortcutAvailability,
  type DesktopSnapShotState,
  DesktopSnapShotSetupAction,
  type ClientSettings,
  type SnapShotModifier,
  type SnapShotModifierPairShortcut,
  type SnapShotShortcut,
  type DesktopSnapShotEvent,
  type DesktopSnapShotId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { startGlobalShiftShortcutProcess } from "./GlobalShiftShortcutProcess.ts";
import { startMacModifierPairShortcutProcess } from "./MacModifierPairShortcutProcess.ts";
import { activeWindow, type ActiveWindow } from "./ActiveWindow.ts";
import { captureMacWindowSnapshot, type MacSnapShotSource } from "./MacSnapShot.ts";
import {
  captureRegionWindowSnapshot,
  makeRegionSnapShotPool,
  type RegionSnapShotPool,
  type RegionSnapShotSource,
} from "./RegionSnapShot.ts";
import { type SnapShotAnimationDestination, SnapShotTransition } from "./SnapShotTransition.ts";
import {
  type AccessibilityProcessPool,
  makeSnapShotAccessibilityProcessPool,
} from "./SnapShotAccessibilityProcess.ts";
import * as MacPermissions from "../permissions/MacPermissions.ts";
import { MAC_PERMISSION_SETTINGS_URLS } from "../permissions/MacPermission.ts";
import { showWindowsCaptureOverlay } from "./WindowsCaptureFeedback.ts";

import {
  boundedSnapShotString,
  sameSnapShotShortcut,
  toElectronAccelerator,
  snapShotShortcutRegistrationFailureMessage,
  snapShotShortcutSystemConflict,
} from "./snapShot.ts";
import { readImageDimensions } from "@t3tools/shared/imageDimensions";

const MAX_CAPTURE_WIDTH = 2_560;
const MAX_CAPTURE_HEIGHT = 1_600;
const SHORTCUT_COOLDOWN_NS = 200_000_000n;
const FLASH_ANIMATION_DURATION_MS = 180;
const FLASH_STATIC_DURATION_MS = 60;
const FLASH_FRAME_INTERVAL_MS = 16;
const FLASH_PEAK_OPACITY = 0.08;
const MAC_SCREEN_CAPTURE_SETTINGS_URL = MAC_PERMISSION_SETTINGS_URLS["screen-recording"];
const MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE =
  "Allow Screen Recording in System Settings, then restart Harp.";
const MAC_ACCESSIBILITY_PERMISSION_MESSAGE =
  "Allow Accessibility in System Settings, then restart Harp.";
const MAC_BOTH_PERMISSIONS_MESSAGE =
  "Allow Accessibility and Screen Recording in System Settings, then restart Harp.";
const MAC_PERMISSION_MESSAGES = new Set([
  MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE,
  MAC_ACCESSIBILITY_PERMISSION_MESSAGE,
  MAC_BOTH_PERMISSIONS_MESSAGE,
]);

const decodePendingCapture = Schema.decodeUnknownEffect(DesktopPendingSnapShot);

const PendingCaptureJson = Schema.fromJsonString(DesktopPendingSnapShot);
const decodePendingCaptureJson = Schema.decodeEffect(PendingCaptureJson);
const encodePendingCaptureJson = Schema.encodeEffect(PendingCaptureJson);
const DesktopSnapShotOperation = Schema.Literals([
  "list-pending",
  "read",
  "acknowledge",
  "unsupported",
  "disabled",
  "window-unavailable",
  "capture",
]);

export class DesktopSnapShotError extends Schema.TaggedError<DesktopSnapShotError>()(
  "DesktopSnapShotError",
  {
    operation: DesktopSnapShotOperation,
    captureId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "list-pending":
        return "Could not list pending snapshots.";
      case "read":
        return "Could not read the snapshot.";
      case "acknowledge":
        return "Could not remove the snapshot.";
      case "unsupported":
        return "SnapShots are not supported here.";
      case "disabled":
        return "Enable SnapShots in Settings first.";
      case "window-unavailable":
        return "The active window is not available for capture.";
      case "capture":
        return "Could not capture the active window.";
    }
  }
}

const isDesktopSnapShotError = Schema.is(DesktopSnapShotError);

function captureFailure(cause: unknown, captureId?: string): DesktopSnapShotError {
  return isDesktopSnapShotError(cause)
    ? cause
    : new DesktopSnapShotError({ operation: "capture", captureId, cause });
}

export class DesktopSnapShot extends Context.Service<
  DesktopSnapShot,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly requestPermissions: (includeAccessibility: boolean) => Effect.Effect<void>;
    readonly state: Effect.Effect<DesktopSnapShotState>;
    readonly setup: (
      action: DesktopSnapShotSetupAction,
    ) => Effect.Effect<void, DesktopSnapShotSetupError>;
    readonly checkShortcut: (
      shortcut: SnapShotShortcut,
    ) => Effect.Effect<DesktopSnapShotShortcutAvailability>;
    readonly setShortcutSuppressed: (suppressed: boolean) => Effect.Effect<void>;
    readonly capture: Effect.Effect<void, DesktopSnapShotError>;
    readonly listPending: Effect.Effect<
      ReadonlyArray<DesktopPendingSnapShot>,
      DesktopSnapShotError
    >;
    readonly read: (id: string) => Effect.Effect<DesktopSnapShotValue, DesktopSnapShotError>;
    readonly setAnimationDestination: (
      id: string,
      destination: SnapShotAnimationDestination,
    ) => Effect.Effect<void>;
    readonly dismissAnimation: (id: string) => Effect.Effect<void>;
    readonly acknowledge: (id: string) => Effect.Effect<void, DesktopSnapShotError>;
  }
>()("@t3tools/desktop/snapShot/DesktopSnapShot") {}

export class DesktopSnapShotSetupError extends Schema.TaggedError<DesktopSnapShotSetupError>()(
  "DesktopSnapShotSetupError",
  {
    action: DesktopSnapShotSetupAction,
    reason: Schema.Literals(["unsupported-session", "setup-failed"]),
    step: Schema.optional(Schema.Literals(["find-window", "capture-window"])),
    status: Schema.optional(Schema.Literals(["missing", "timed-out", "exited", "failed"])),
    exitCode: Schema.optional(Schema.Number),
    /** The running app, as macOS lists it under Privacy & Security. */
    appName: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    if (this.action === "test-mac-capture") {
      if (this.reason === "unsupported-session") return "Test capture requires macOS.";
      const summary = "Could not capture a test snapshot.";
      if (this.step === undefined) return summary;
      if (this.status === "missing") return `${summary} No window is available to capture.`;
      const [task, command] =
        this.step === "find-window"
          ? ["Finding the front window", "osascript"]
          : ["Capturing the window", "screencapture"];
      const failure =
        this.status === "timed-out"
          ? `${task} timed out.`
          : this.status === "exited" && this.exitCode !== undefined
            ? `${task} failed: ${command} exited with code ${this.exitCode}.`
            : `${task} failed.`;
      // macOS can report both permissions as allowed while they belong to another install.
      return this.appName === undefined
        ? `${summary} ${failure}`
        : `${summary} ${failure} macOS grants Screen Recording and Accessibility to each app separately. In System Settings, open Privacy & Security and check that "${this.appName}" is allowed for both.`;
    }
    return this.reason === "unsupported-session"
      ? "This setup step requires macOS."
      : "Could not complete the setup step.";
  }
}

function macCommandFailure(cause: unknown) {
  const failure = Predicate.isObject(cause) ? cause : {};
  if ("killed" in failure && failure.killed === true) return { status: "timed-out" } as const;
  return "code" in failure && typeof failure.code === "number"
    ? ({ status: "exited", exitCode: failure.code } as const)
    : ({ status: "failed" } as const);
}

type SnapShotSystemAnimationSettings = Pick<
  ReturnType<typeof Electron.systemPreferences.getAnimationSettings>,
  "prefersReducedMotion" | "shouldRenderRichAnimation"
>;

function captureMode(platform: NodeJS.Platform): DesktopSnapShotState["mode"] {
  return platform === "darwin" || platform === "win32" ? "direct" : "unavailable";
}

function shouldAnimateSnapShot(settings: SnapShotSystemAnimationSettings): boolean {
  return settings.shouldRenderRichAnimation && !settings.prefersReducedMotion;
}

function snapShotThumbnailSize(active: ActiveWindow): Electron.Size {
  return {
    width: Math.min(Math.max(active.bounds.width, 1), MAX_CAPTURE_WIDTH),
    height: Math.min(Math.max(active.bounds.height, 1), MAX_CAPTURE_HEIGHT),
  };
}

function snapShotIconDataUrl(
  ...icons: ReadonlyArray<Electron.NativeImage | null | undefined>
): string | undefined {
  const icon = icons.find((candidate): candidate is Electron.NativeImage =>
    Boolean(candidate && !candidate.isEmpty()),
  );
  if (!icon) return undefined;
  return icon.resize({ width: 64, height: 64, quality: "best" }).toDataURL({ scaleFactor: 2 });
}

async function appFileIcon(
  path: string,
  platform: NodeJS.Platform,
): Promise<Electron.NativeImage | undefined> {
  if (platform === "darwin") {
    const thumbnail = await Electron.nativeImage
      .createThumbnailFromPath(path, { width: 64, height: 64 })
      .catch(() => undefined);
    if (thumbnail && !thumbnail.isEmpty()) return thumbnail;
  }
  return Electron.app.getFileIcon(path, { size: "normal" }).catch(() => undefined);
}

async function iconDataUrl(
  source: { readonly appIcon?: Electron.NativeImage | null },
  active: ActiveWindow,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  try {
    const fileIcon = active.owner.path ? await appFileIcon(active.owner.path, platform) : undefined;
    return snapShotIconDataUrl(fileIcon, source.appIcon);
  } catch {
    return undefined;
  }
}

function snapShotAppName(active: ActiveWindow, sourceName: string): string {
  const appName = active.owner.name.trim() || sourceName.trim() || "Window";
  if (active.platform !== "windows") return appName;
  return appName.replace(/\.exe$/i, "").trim() || appName;
}

async function requestMacScreenCapturePermission(): Promise<string | null> {
  let status: ReturnType<typeof Electron.systemPreferences.getMediaAccessStatus>;
  try {
    status = Electron.systemPreferences.getMediaAccessStatus("screen");
    if (status === "granted") return null;
    if (status === "not-determined") {
      try {
        await Electron.desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 },
        });
      } catch {}
      status = Electron.systemPreferences.getMediaAccessStatus("screen");
      if (status === "granted") return null;
    }
  } catch {}
  await Electron.shell.openExternal(MAC_SCREEN_CAPTURE_SETTINGS_URL).catch(() => undefined);
  return MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE;
}

function currentMacPermissions(): NonNullable<DesktopSnapShotState["macPermissions"]> {
  return {
    screenRecording: Electron.systemPreferences.getMediaAccessStatus("screen") === "granted",
    accessibility: Electron.systemPreferences.isTrustedAccessibilityClient(false),
  };
}

function macPermissionMessage(
  permissions: NonNullable<DesktopSnapShotState["macPermissions"]>,
  includeAccessibility: boolean,
): string | null {
  const accessibilityGranted = !includeAccessibility || permissions.accessibility;
  if (!accessibilityGranted && !permissions.screenRecording) {
    return MAC_BOTH_PERMISSIONS_MESSAGE;
  }
  if (!accessibilityGranted) {
    return MAC_ACCESSIBILITY_PERMISSION_MESSAGE;
  }
  return permissions.screenRecording ? null : MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE;
}

function currentMacSnapShotPermissionMessage(includeAccessibility: boolean): string | null {
  return macPermissionMessage(
    {
      screenRecording: Electron.systemPreferences.getMediaAccessStatus("screen") === "granted",
      accessibility:
        !includeAccessibility || Electron.systemPreferences.isTrustedAccessibilityClient(false),
    },
    includeAccessibility,
  );
}

async function requestMacSnapShotPermissions(
  includeAccessibility: boolean,
): Promise<string | null> {
  const accessibilityGranted =
    !includeAccessibility || Electron.systemPreferences.isTrustedAccessibilityClient(true);
  const screenMessage = await requestMacScreenCapturePermission();
  if (!accessibilityGranted && screenMessage) {
    return MAC_BOTH_PERMISSIONS_MESSAGE;
  }
  if (!accessibilityGranted) {
    return MAC_ACCESSIBILITY_PERMISSION_MESSAGE;
  }
  return screenMessage;
}

function snapShotImageSize(png: Buffer, fallback: Electron.Rectangle): Electron.Size {
  // Capture backends already validate or encode the PNG. Reading its header
  // avoids decoding every pixel again just to size accessibility coordinates.
  const size = readImageDimensions(png);
  if (size) return size;
  return {
    width: Math.max(1, Math.round(fallback.width)),
    height: Math.max(1, Math.round(fallback.height)),
  };
}

async function captureSource({
  captureId,
  platform,
  settings,
  flash,
  transition,
  imageTempPath,
  accessibilityProcessPool,
  regionSnapShotPool,
  prepareReveal,
}: {
  captureId: string;
  platform: NodeJS.Platform;
  settings: ClientSettings;
  flash: SnapShotFlash;
  transition: SnapShotTransition;
  imageTempPath: string;
  accessibilityProcessPool: AccessibilityProcessPool;
  regionSnapShotPool: RegionSnapShotPool;
  prepareReveal: () => Promise<void>;
}) {
  const destinationWindow =
    Electron.BrowserWindow.getFocusedWindow() ??
    Electron.BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  const destinationWindowBounds = destinationWindow?.getBounds();
  const revealPreparation =
    platform === "win32" ? prepareReveal().catch(() => undefined) : Promise.resolve();
  const active = await activeWindow(platform);
  if (!active) {
    throw new DesktopSnapShotError({ operation: "window-unavailable", captureId });
  }

  let source: MacSnapShotSource | RegionSnapShotSource;
  let png: Buffer;
  let imageTempReady = false;
  if (platform === "darwin") {
    ({ source, png } = await captureMacWindowSnapshot(
      active,
      imageTempPath,
      snapShotThumbnailSize(active),
    ));
    imageTempReady = true;
  } else {
    ({ source, png } = await captureRegionWindowSnapshot(
      regionSnapShotPool,
      active,
      snapShotFlashBounds(active, platform),
      snapShotThumbnailSize(active),
    ));
  }
  const accessibilityRead = settings.snapShotIncludeAccessibility
    ? accessibilityProcessPool.read({
        active: { ...active, bounds: snapShotFlashBounds(active, platform) },
        platform,
        sourceTitle: source.name,
        imageSize: snapShotImageSize(png, active.bounds),
      })
    : undefined;
  if (accessibilityRead) {
    await accessibilityRead.started;
  }
  const contextPromise = accessibilityRead?.result ?? Promise.resolve(undefined);
  await revealPreparation;
  const animationStarted = await showCaptureFeedback(
    transition,
    flash,
    captureId,
    `data:image/png;base64,${png.toString("base64")}`,
    settings,
    active,
    platform,
    destinationWindowBounds,
  );
  return { source, active, contextPromise, animationStarted, png, imageTempReady };
}

function createSnapShotFlashWindow(bounds: Electron.Rectangle): Electron.BaseWindow {
  const window = new Electron.BaseWindow({
    ...bounds,
    alwaysOnTop: true,
    focusable: false,
    frame: false,
    hasShadow: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#ffffff",
    opacity: FLASH_PEAK_OPACITY,
    transparent: false,
  });
  window.setIgnoreMouseEvents(true);
  return window;
}

export class SnapShotFlash {
  private flashWindow: Electron.BaseWindow | undefined;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly showWindow: (window: Electron.BaseWindow) => void;

  constructor(
    showWindow: (window: Electron.BaseWindow) => void = (window) => window.showInactive(),
  ) {
    this.showWindow = showWindow;
  }

  showAnimated(bounds: Electron.Rectangle): Promise<void> {
    return this.show(bounds, true, FLASH_ANIMATION_DURATION_MS);
  }

  showStatic(bounds: Electron.Rectangle): Promise<void> {
    return this.show(bounds, false, FLASH_STATIC_DURATION_MS);
  }

  dispose(): void {
    if (this.animationTimer) clearInterval(this.animationTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.animationTimer = undefined;
    this.closeTimer = undefined;
    if (this.flashWindow && !this.flashWindow.isDestroyed()) this.flashWindow.destroy();
    this.flashWindow = undefined;
  }

  private async show(
    bounds: Electron.Rectangle,
    animated: boolean,
    durationMs: number,
  ): Promise<void> {
    this.dispose();
    const window = createSnapShotFlashWindow(bounds);
    this.flashWindow = window;
    if (window.isDestroyed()) return;
    this.showWindow(window);
    if (animated) {
      let opacity = FLASH_PEAK_OPACITY;
      this.animationTimer = setInterval(() => {
        if (window.isDestroyed()) return this.dispose();
        opacity = Math.max(
          0,
          opacity - (FLASH_PEAK_OPACITY * FLASH_FRAME_INTERVAL_MS) / durationMs,
        );
        window.setOpacity(opacity);
      }, FLASH_FRAME_INTERVAL_MS);
    }
    this.closeTimer = setTimeout(() => {
      if (this.flashWindow === window) this.dispose();
    }, durationMs);
  }
}

function snapShotFlashBounds(active: ActiveWindow, platform: NodeJS.Platform): Electron.Rectangle {
  return platform === "win32"
    ? Electron.screen.screenToDipRect(null, active.bounds)
    : active.bounds;
}

async function showCaptureFeedback(
  transition: SnapShotTransition,
  flash: SnapShotFlash,
  captureId: string,
  snapshotDataUrl: string,
  settings: ClientSettings,
  active: ActiveWindow,
  platform: NodeJS.Platform,
  destinationWindowBounds?: Electron.Rectangle,
): Promise<boolean> {
  const bounds = snapShotFlashBounds(active, platform);
  const animationsEnabled =
    settings.snapShotAnimations &&
    shouldAnimateSnapShot(Electron.systemPreferences.getAnimationSettings());
  if (animationsEnabled) {
    try {
      await transition.begin(
        captureId,
        bounds,
        snapshotDataUrl,
        settings.snapShotFlash,
        destinationWindowBounds,
      );
      return true;
    } catch {
      transition.dispose();
    }
  }
  if (!settings.snapShotFlash) return false;
  const playback = animationsEnabled ? flash.showAnimated(bounds) : flash.showStatic(bounds);
  await playback.catch(() => undefined);
  return false;
}

function observedPairMessage(
  shortcut: SnapShotModifierPairShortcut,
  platform: NodeJS.Platform,
): string {
  const modifier = snapShotShortcutModifierPair(shortcut);
  const label = snapShotModifierPairLabel(modifier, platform === "darwin");
  const base = `${label} is observed and cannot be reserved exclusively.`;
  if (modifier === "meta" && platform !== "darwin") {
    return `${base} This key can also open the system's own menu.`;
  }
  if (modifier === "alt" && platform === "win32") {
    return `${base} This key can also activate app menu bars.`;
  }
  return base;
}

function probeGlobalShortcut(accelerator: string): DesktopSnapShotShortcutAvailability {
  try {
    if (!Electron.globalShortcut.register(accelerator, () => undefined)) {
      return {
        available: false,
        message: "This shortcut is already used by the system or another app.",
      };
    }
    Electron.globalShortcut.unregister(accelerator);
    return { available: true, message: null };
  } catch {
    return { available: false, message: "The system could not register this shortcut." };
  }
}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const permissions = yield* MacPermissions.MacPermissions;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settingsRef = yield* Ref.make(DEFAULT_CLIENT_SETTINGS);
  const stateRef = yield* Ref.make<DesktopSnapShotState>({
    mode: captureMode(environment.platform),
    shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
    shortcutRegistered: false,
    shortcutMessage: null,
    message: null,
  });
  const snapshotMutex = yield* Semaphore.make(1);
  const configurationMutex = yield* Semaphore.make(1);
  const context = yield* Effect.context<
    DesktopEnvironment.DesktopEnvironment | DesktopWindow.DesktopWindow
  >();
  const runPromise = Effect.runPromiseWith(context);
  const captureDirectory = path.join(environment.stateDir, "snap-shots");
  let shortcutVerified = false;
  const shiftShortcutWorkerPath = path.join(__dirname, "snapShot", "GlobalShiftShortcutWorker.cjs");
  const accessibilityWorkerPath = path.join(
    __dirname,
    "snapShot",
    "SnapShotAccessibilityWorker.cjs",
  );
  const accessibilityProcessPool = makeSnapShotAccessibilityProcessPool(accessibilityWorkerPath);
  const regionSnapShotPool = makeRegionSnapShotPool(
    path.join(__dirname, "snapShot", "RegionSnapShotWorker.cjs"),
  );
  let registeredAccelerator: string | undefined;
  let initialized = false;
  let shortcutGeneration = 0;
  let shortcutSuppressed = false;
  let lastShortcutAt: bigint | undefined;
  let stopShiftShortcut: (() => void) | undefined;
  const showCaptureWindow =
    environment.platform === "win32" ? showWindowsCaptureOverlay : undefined;
  const flash = new SnapShotFlash(showCaptureWindow);
  const transition = new SnapShotTransition({
    showWindow: showCaptureWindow,
    waitForCompositorFrame: environment.platform === "win32",
    // Transparent Windows surfaces must not resize while their compositor animation is running.
    boundOverlayToCaptureDisplays: true,
    alwaysOnTopLevel: "pop-up-menu",
  });

  const startPairShortcutProcess = (
    modifier: SnapShotModifier,
    onTrigger: () => void,
    onFailure: (error: Error) => void,
  ) =>
    environment.platform === "darwin"
      ? startMacModifierPairShortcutProcess(modifier, onTrigger, onFailure)
      : startGlobalShiftShortcutProcess(shiftShortcutWorkerPath, modifier, onTrigger, onFailure);

  const releaseShortcut = () => {
    shortcutGeneration++;
    if (registeredAccelerator) {
      Electron.globalShortcut.unregister(registeredAccelerator);
      registeredAccelerator = undefined;
    }
    stopShiftShortcut?.();
    stopShiftShortcut = undefined;
  };

  const emit = (event: DesktopSnapShotEvent) =>
    desktopWindow.dispatchSnapShotEvent(event).pipe(Effect.ignoreCause);
  const setFailure = (message: string, captureId?: string) =>
    Ref.update(stateRef, (state) => ({ ...state, message })).pipe(
      Effect.andThen(
        emit(
          captureId ? { type: "failed", id: captureId as DesktopSnapShotId } : { type: "failed" },
        ),
      ),
    );
  const setShortcutFailure = (shortcutMessage: string) =>
    Effect.sync(() => {
      shortcutVerified = false;
    }).pipe(
      Effect.andThen(
        Ref.update(stateRef, (state) => ({
          ...state,
          shortcutRegistered: false,
          shortcutMessage,
        })),
      ),
      Effect.andThen(emit({ type: "failed" })),
    );

  const discardCapture = Effect.fn("desktop.snapShot.discardCapture")(function* (id: string) {
    transition.dismiss(id);
    yield* Effect.forEach(
      [`${id}.png`, `${id}.tmp.png`, `${id}.json`, `${id}.json.tmp`],
      (name) => fileSystem.remove(path.join(captureDirectory, name), { force: true }),
      { concurrency: "unbounded", discard: true },
    ).pipe(Effect.ignore);
  });

  const prepareCapture = Effect.fn("desktop.snapShot.prepareCapture")(function* (
    settings: ClientSettings,
  ) {
    const id = yield* crypto.randomUUIDv4().pipe(Effect.mapError((cause) => captureFailure(cause)));
    const mode = captureMode(environment.platform);
    if (mode === "unavailable") {
      return yield* new DesktopSnapShotError({ operation: "unsupported", captureId: id });
    }
    const imageTempPath = path.join(captureDirectory, `${id}.tmp.png`);

    return yield* Effect.gen(function* () {
      // Retire feedback before capture so rapid captures cannot photograph the previous overlay.
      flash.dispose();
      transition.dispose();
      yield* fileSystem.makeDirectory(captureDirectory, { recursive: true });
      yield* emit({ type: "requested", id: id as DesktopSnapShotId });
      const snapshot = yield* Effect.tryPromise({
        try: () =>
          captureSource({
            captureId: id,
            platform: environment.platform,
            settings,
            flash,
            transition,
            imageTempPath,
            accessibilityProcessPool,
            regionSnapShotPool,
            prepareReveal: () => runPromise(desktopWindow.prepareCaptureReveal),
          }),
        catch: (cause) => captureFailure(cause, id),
      });
      const capturedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      if (snapshot.animationStarted) {
        yield* emit({ type: "started", id: id as DesktopSnapShotId });
      } else {
        yield* desktopWindow.activate.pipe(Effect.ignoreCause);
      }
      return { id, capturedAt, ...snapshot };
    }).pipe(Effect.mapError((cause) => captureFailure(cause, id)));
  });

  const persistCapture = Effect.fn("desktop.snapShot.persistCapture")(function* (
    capture: Effect.Success<ReturnType<typeof prepareCapture>>,
  ) {
    const { id, capturedAt, source, active, contextPromise, png, imageTempReady } = capture;
    const imagePath = path.join(captureDirectory, `${id}.png`);
    const imageTempPath = path.join(captureDirectory, `${id}.tmp.png`);
    const metadataPath = path.join(captureDirectory, `${id}.json`);

    yield* Effect.gen(function* () {
      const accessibilityContext = yield* Effect.promise(() => contextPromise);
      const appIconDataUrl = yield* Effect.promise(() =>
        iconDataUrl(source, active, environment.platform),
      );
      const appIdentifier = boundedSnapShotString(
        active.platform === "macos" ? active.owner.bundleId : undefined,
        255,
      );
      const pending = yield* decodePendingCapture({
        id,
        name: `window-${capturedAt.replaceAll(":", "-")}.png`,
        mimeType: "image/png",
        sizeBytes: png.byteLength,
        source: {
          kind: "snap-shot",
          capturedAt,
          appName: boundedSnapShotString(snapShotAppName(active, source.name), 255) ?? "Window",
          windowTitle: boundedSnapShotString(active.title.trim() || source.name, 1_000) ?? "",
          ...(accessibilityContext?.accessibleText
            ? { accessibleText: accessibilityContext.accessibleText }
            : {}),
          ...(accessibilityContext?.accessibility
            ? { accessibility: accessibilityContext.accessibility }
            : {}),
          ...(appIdentifier ? { appIdentifier } : {}),
          ...(appIconDataUrl ? { appIconDataUrl } : {}),
        },
      });
      if (!imageTempReady) yield* fileSystem.writeFile(imageTempPath, png);
      yield* fileSystem.rename(imageTempPath, imagePath);
      yield* fileSystem.writeFileString(
        metadataPath + ".tmp",
        yield* encodePendingCaptureJson(pending),
      );
      yield* fileSystem.rename(metadataPath + ".tmp", metadataPath);
    }).pipe(Effect.mapError((cause) => captureFailure(cause, id)));
  });

  const capture = Effect.gen(function* () {
    const settings = yield* Ref.get(settingsRef);
    if (!settings.snapShotEnabled) {
      return yield* new DesktopSnapShotError({ operation: "disabled" });
    }
    const prepared = yield* prepareCapture(settings).pipe(
      Effect.tapError((error) =>
        (error.captureId ? discardCapture(error.captureId) : Effect.void).pipe(
          Effect.andThen(setFailure(error.message, error.captureId)),
        ),
      ),
      snapshotMutex.withPermitsIfAvailable(1),
    );
    if (Option.isNone(prepared)) return;
    const capture = prepared.value;
    yield* persistCapture(capture).pipe(
      Effect.tap(() =>
        Ref.update(stateRef, (state) => ({ ...state, message: null })).pipe(
          Effect.andThen(emit({ type: "ready", id: capture.id as DesktopSnapShotId })),
        ),
      ),
      Effect.tapError((error) =>
        discardCapture(capture.id).pipe(
          Effect.andThen(Ref.update(stateRef, (state) => ({ ...state, message: error.message }))),
          Effect.andThen(emit({ type: "failed", id: capture.id as DesktopSnapShotId })),
        ),
      ),
    );
  }).pipe(Effect.withSpan("desktop.snapShot.capture"));

  const captureFromShortcut = Effect.gen(function* () {
    // Repeated shortcuts must not replace a capture during its flight.
    if (shortcutSuppressed || transition.isAnimating) return;
    shortcutVerified = true;
    const now = yield* Clock.currentTimeNanos;
    if (lastShortcutAt !== undefined && now - lastShortcutAt < SHORTCUT_COOLDOWN_NS) return;
    lastShortcutAt = now;
    yield* capture;
  }).pipe(Effect.withSpan("desktop.snapShot.shortcutActivated"));
  const onShortcut = () => runPromise(captureFromShortcut).catch(() => undefined);

  const checkShortcut = Effect.fn("desktop.snapShot.checkShortcut")(function* (
    shortcut: SnapShotShortcut,
  ) {
    const mode = captureMode(environment.platform);
    if (mode === "unavailable") {
      return { available: false, message: "SnapShots are not supported on this platform." };
    }
    if (isModifierPairShortcut(shortcut)) {
      const available = yield* Effect.tryPromise(() =>
        startPairShortcutProcess(
          snapShotShortcutModifierPair(shortcut),
          () => undefined,
          () => undefined,
        ),
      ).pipe(
        Effect.tap((stop) => Effect.sync(stop)),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      return {
        available,
        message: available
          ? observedPairMessage(shortcut, environment.platform)
          : snapShotShortcutRegistrationFailureMessage(shortcut, environment.platform),
      };
    }
    const systemConflict = snapShotShortcutSystemConflict(shortcut);
    if (systemConflict) return { available: false, message: systemConflict };
    const accelerator = toElectronAccelerator(shortcut);
    const available =
      registeredAccelerator === accelerator
        ? { available: true, message: null }
        : probeGlobalShortcut(accelerator);
    return available;
  });

  const applySettings = Effect.fn("desktop.snapShot.applySettings")(function* (
    settings: ClientSettings,
    requestedPermissionMessage: string | null,
    forceShortcut = false,
  ) {
    const previousSettings = yield* Ref.get(settingsRef);
    yield* Ref.set(settingsRef, settings);

    const mode = captureMode(environment.platform);
    const shortcut = settings.snapShotShortcut;
    if (
      settings.snapShotEnabled &&
      settings.snapShotIncludeAccessibility &&
      mode !== "unavailable"
    ) {
      accessibilityProcessPool.warm();
    } else {
      accessibilityProcessPool.cool();
    }
    if (settings.snapShotEnabled && environment.platform === "win32") {
      regionSnapShotPool.warm();
    } else {
      regionSnapShotPool.cool();
    }
    if (!settings.snapShotEnabled || !settings.snapShotFlash || mode === "unavailable") {
      flash.dispose();
    }
    if (!settings.snapShotEnabled || !settings.snapShotAnimations || mode === "unavailable") {
      transition.dispose();
    }
    // Unrelated settings saves must not uninstall the keyboard hook.
    const shortcutInputsChanged =
      settings.snapShotEnabled !== previousSettings.snapShotEnabled ||
      settings.snapShotIncludeAccessibility !== previousSettings.snapShotIncludeAccessibility ||
      !sameSnapShotShortcut(shortcut, previousSettings.snapShotShortcut);
    if (!forceShortcut && initialized && !shortcutInputsChanged) {
      yield* Ref.update(stateRef, (state) => ({ ...state, shortcut }));
      return;
    }
    initialized = true;
    releaseShortcut();
    shortcutVerified = false;
    const generation = shortcutGeneration;
    const onCurrentShortcut = () => {
      if (generation === shortcutGeneration) return onShortcut();
      return Promise.resolve();
    };
    if (!settings.snapShotEnabled || mode === "unavailable") {
      yield* Ref.set(stateRef, {
        mode,
        shortcut,
        shortcutRegistered: false,
        shortcutMessage: null,
        message: mode === "unavailable" ? "SnapShots are not supported on this platform." : null,
      });
      return;
    }

    const permissionMessage =
      requestedPermissionMessage ??
      (environment.platform === "darwin"
        ? currentMacSnapShotPermissionMessage(settings.snapShotIncludeAccessibility)
        : null);
    if (permissionMessage) {
      yield* Ref.set(stateRef, {
        mode,
        shortcut,
        shortcutRegistered: false,
        shortcutMessage: null,
        message: permissionMessage,
      });
      return;
    }

    let registered = false;
    if (isModifierPairShortcut(shortcut)) {
      registered = yield* Effect.tryPromise(() =>
        startPairShortcutProcess(snapShotShortcutModifierPair(shortcut), onCurrentShortcut, () => {
          void runPromise(
            setShortcutFailure(
              snapShotShortcutRegistrationFailureMessage(shortcut, environment.platform),
            ),
          ).catch(() => undefined);
        }),
      ).pipe(
        Effect.tap((stop) =>
          Effect.sync(() => {
            stopShiftShortcut = stop;
          }),
        ),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    } else {
      const accelerator = toElectronAccelerator(shortcut);
      registered = Electron.globalShortcut.register(accelerator, onCurrentShortcut);
      if (registered) registeredAccelerator = accelerator;
    }

    yield* Ref.set(stateRef, {
      mode,
      shortcut,
      shortcutRegistered: registered,
      message: null,
      shortcutMessage: registered
        ? isModifierPairShortcut(shortcut)
          ? observedPairMessage(shortcut, environment.platform)
          : null
        : snapShotShortcutRegistrationFailureMessage(shortcut, environment.platform),
    });
  });

  const setShortcutSuppressed = (suppressed: boolean) =>
    Effect.sync(() => {
      shortcutSuppressed = suppressed;
    });

  const configure = Effect.fn("desktop.snapShot.configure")(function* (settings: ClientSettings) {
    yield* configurationMutex.withPermits(1)(applySettings(settings, null));
  });

  const requestPermissions = Effect.fn("desktop.snapShot.requestPermissions")(function* (
    includeAccessibility: boolean,
  ) {
    if (environment.platform !== "darwin") return;
    const owner = Electron.BrowserWindow.getFocusedWindow();
    yield* Effect.promise(() => requestMacSnapShotPermissions(includeAccessibility));
    if (Electron.systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      yield* permissions.showHelper("screen-recording", owner);
    } else if (
      includeAccessibility &&
      !Electron.systemPreferences.isTrustedAccessibilityClient(false)
    ) {
      yield* Effect.promise(() =>
        Electron.shell
          .openExternal(MAC_PERMISSION_SETTINGS_URLS.accessibility)
          .catch(() => undefined),
      );
      yield* permissions.showHelper("accessibility", owner);
    }
  }, configurationMutex.withPermits(1));

  const setup = Effect.fn("desktop.snapShot.setup")(function* (action: DesktopSnapShotSetupAction) {
    if (action === "test-mac-capture") {
      if (environment.platform !== "darwin")
        return yield* new DesktopSnapShotSetupError({ action, reason: "unsupported-session" });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fileSystem
            .makeTempDirectoryScoped({ prefix: "t3-snapshot-test-" })
            .pipe(
              Effect.mapError(
                (cause) => new DesktopSnapShotSetupError({ action, reason: "setup-failed", cause }),
              ),
            );
          const active = yield* Effect.tryPromise({
            try: () => activeWindow("darwin"),
            catch: (cause) =>
              new DesktopSnapShotSetupError({
                action,
                reason: "setup-failed",
                step: "find-window",
                ...macCommandFailure(cause),
                appName: environment.displayName,
                cause,
              }),
          });
          if (!active)
            return yield* new DesktopSnapShotSetupError({
              action,
              reason: "setup-failed",
              step: "find-window",
              status: "missing",
            });
          yield* Effect.tryPromise({
            try: () =>
              captureMacWindowSnapshot(
                active,
                path.join(directory, "test.png"),
                snapShotThumbnailSize(active),
              ),
            catch: (cause) =>
              new DesktopSnapShotSetupError({
                action,
                reason: "setup-failed",
                step: "capture-window",
                ...macCommandFailure(cause),
                appName: environment.displayName,
                cause,
              }),
          });
        }),
      );
      return;
    } else if (action === "allow-screen-recording" || action === "allow-accessibility") {
      if (environment.platform !== "darwin")
        return yield* new DesktopSnapShotSetupError({
          action,
          reason: "unsupported-session",
        });
      const owner = Electron.BrowserWindow.getFocusedWindow();
      if (action === "allow-accessibility") {
        const granted = Electron.systemPreferences.isTrustedAccessibilityClient(true);
        if (!granted && environment.isPackaged) {
          yield* Effect.promise(() =>
            Electron.shell
              .openExternal(MAC_PERMISSION_SETTINGS_URLS.accessibility)
              .catch(() => undefined),
          );
        }
      } else yield* Effect.promise(requestMacScreenCapturePermission);
      yield* permissions.showHelper(
        action === "allow-accessibility" ? "accessibility" : "screen-recording",
        owner,
      );
    } else yield* applySettings(yield* Ref.get(settingsRef), null, true);
  }, configurationMutex.withPermits(1));

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      releaseShortcut();
      flash.dispose();
      transition.dispose();
      accessibilityProcessPool.close();
      regionSnapShotPool.close();
    }),
  );

  return DesktopSnapShot.of({
    initialize: configurationMutex.withPermits(1)(
      clientSettings.get.pipe(
        Effect.flatMap((stored) =>
          applySettings(
            Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS),
            null,
          ),
        ),
        Effect.ignore,
      ),
    ),
    configure,
    requestPermissions,
    setup,
    state: Ref.get(stateRef).pipe(
      Effect.flatMap((state) =>
        environment.platform === "darwin"
          ? Effect.gen(function* () {
              const settings = yield* Ref.get(settingsRef);
              const macPermissions = currentMacPermissions();
              const message = settings.snapShotEnabled
                ? macPermissionMessage(macPermissions, settings.snapShotIncludeAccessibility)
                : null;
              const recovered =
                message === null &&
                state.message !== null &&
                MAC_PERMISSION_MESSAGES.has(state.message)
                  ? yield* configurationMutex
                      .withPermits(1)(applySettings(settings, null, true))
                      .pipe(Effect.andThen(Ref.get(stateRef)))
                  : state;
              return { ...recovered, macPermissions, ...(message ? { message } : {}) };
            })
          : Effect.succeed(environment.platform === "win32" ? { ...state, windows: true } : state),
      ),
      Effect.map((state) => ({ ...state, shortcutVerified })),
    ),
    checkShortcut,
    setShortcutSuppressed,
    capture,
    listPending: fileSystem.readDirectory(captureDirectory).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(cause),
      }),
      Effect.flatMap((names) =>
        Effect.forEach(
          names.filter((name) => name.endsWith(".json") && !name.endsWith(".json.tmp")),
          (name) =>
            fileSystem.readFileString(path.join(captureDirectory, name)).pipe(
              Effect.flatMap(decodePendingCaptureJson),
              Effect.orElseSucceed(() => undefined),
            ),
          { concurrency: "unbounded" },
        ),
      ),
      Effect.map((captures) =>
        captures
          .filter((capture) => capture !== undefined)
          .sort((left, right) => left.source.capturedAt.localeCompare(right.source.capturedAt)),
      ),
      Effect.mapError((cause) => new DesktopSnapShotError({ operation: "list-pending", cause })),
    ),
    read: Effect.fn("DesktopSnapShot.read")(
      function* (id) {
        const metadata = yield* fileSystem
          .readFileString(path.join(captureDirectory, `${id}.json`))
          .pipe(Effect.flatMap(decodePendingCaptureJson));
        const png = yield* fileSystem.readFile(path.join(captureDirectory, `${id}.png`));
        return {
          ...metadata,
          dataUrl: `data:image/png;base64,${Base64.encode(png)}`,
        };
      },
      (effect, id) =>
        effect.pipe(
          Effect.mapError(
            (cause) => new DesktopSnapShotError({ operation: "read", captureId: id, cause }),
          ),
        ),
    ),
    setAnimationDestination: (id, destination) =>
      Effect.promise(async () => {
        transition.animateTo(id, destination);
        await transition.waitForLanding(id);
      }),
    dismissAnimation: (id) => Effect.sync(() => transition.dismiss(id)),
    acknowledge: (id) =>
      Effect.promise(() => transition.complete(id)).pipe(
        Effect.andThen(
          Effect.all(
            [
              fileSystem.remove(path.join(captureDirectory, `${id}.json`), { force: true }),
              fileSystem.remove(path.join(captureDirectory, `${id}.png`), { force: true }),
            ],
            { concurrency: "unbounded", discard: true },
          ),
        ),
        Effect.mapError(
          (cause) => new DesktopSnapShotError({ operation: "acknowledge", captureId: id, cause }),
        ),
      ),
  });
});

export const layer = Layer.effect(DesktopSnapShot, make);
