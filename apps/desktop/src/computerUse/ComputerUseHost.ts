// @effect-diagnostics globalTimers:off globalDate:off -- Input pacing and app-launch waits run in Electron callbacks, outside any Effect fiber.
/**
 * Runs the server's computer-use actions on this machine. One thread drives
 * the computer at a time; while it does, the Harp window shrinks into an
 * overlay that stays out of screenshots, and apps the agent was not granted
 * are minimized so they stay out of its way.
 */
import {
  ComputerUseCommand,
  ComputerUseEvent,
  type ComputerUseAction,
  type ComputerUseActionResult,
  type ComputerUseCommand as ComputerUseCommandType,
  type ComputerUseEvent as ComputerUseEventType,
  type ComputerUseGrant,
} from "@t3tools/contracts";
import {
  authorizeComputerUseAction,
  computerUseGrantMatches,
  computerUseTierForApp,
  findComputerUseGrant,
} from "@t3tools/shared/computerUse";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Electron from "electron";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { askForComputerAccess, ComputerUseOverlay } from "./ComputerUseWindows.ts";
import { imageToPhysical, isInsideImage, screenGeometry, type ScreenGeometry } from "./geometry.ts";
import { parseChord, parseModifiers } from "./keys.ts";
import {
  appWindowAtPoint,
  bringToFront,
  findAppWindow,
  foregroundAppWindow,
  launchApp,
  listAppWindows,
  minimizeWithoutFocus,
  isMinimized,
  restoreWithoutFocus,
  type AppWindow,
} from "./WindowsApps.ts";
import {
  buttonEvent,
  chordEvents,
  clickEvents,
  loadWindowsInputApi,
  scrollEvents,
  typeTextEvents,
} from "./WindowsInput.ts";

const encodeEvent = Schema.encodeSync(Schema.fromJsonString(ComputerUseEvent));
const decodeCommand = Schema.decodeUnknownOption(Schema.fromJsonString(ComputerUseCommand));
const lineEncoder = new TextEncoder();

const STOP_SHORTCUT = "Escape";
const APP_LAUNCH_TIMEOUT_MS = 10_000;
/** Windows animates minimizing; a capture taken sooner shows windows mid-flight. */
const SETTLE_AFTER_HIDING_MS = 350;
const DRAG_STEPS = 12;
const TYPE_INTERVAL_MS = 12;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class ComputerUseRefusal extends Error {}

export class ComputerUseHost extends Context.Service<
  ComputerUseHost,
  {
    readonly events: Stream.Stream<Uint8Array>;
    readonly handleCommandLine: (line: string) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/computerUse/ComputerUseHost") {}

interface DrivingSession {
  readonly threadId: string;
  readonly hidden: Array<bigint>;
  geometry: ScreenGeometry | undefined;
  /** False once the user pressed Stop; the overlay is gone but hidden apps wait for the turn's end. */
  overlayShown: boolean;
}

export const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const platform = yield* HostProcess.Platform;
  const outbox = yield* PubSub.unbounded<ComputerUseEventType>();
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const emit = (event: ComputerUseEventType) => runFork(PubSub.publish(outbox, event));

  const grantsByThread = new Map<string, Array<ComputerUseGrant>>();
  let session: DrivingSession | undefined;
  let stopShortcutRegistered = false;

  const mainWindow = () =>
    runPromise(electronWindow.main).then((main) => Option.getOrUndefined(main));

  const stop = () => {
    const current = session;
    if (current === undefined || !current.overlayShown) return;
    emit({ type: "stop", threadId: current.threadId });
    void leaveOverlay(current);
  };
  const overlay = new ComputerUseOverlay(stop);

  const registerStopShortcut = () => {
    if (stopShortcutRegistered) return;
    stopShortcutRegistered = Electron.globalShortcut.register(STOP_SHORTCUT, stop);
  };
  const unregisterStopShortcut = () => {
    if (!stopShortcutRegistered) return;
    Electron.globalShortcut.unregister(STOP_SHORTCUT);
    stopShortcutRegistered = false;
  };
  /** The stop hotkey would otherwise swallow the agent's own Esc presses. */
  const withoutStopShortcut = async <A>(run: () => Promise<A>): Promise<A> => {
    const wasRegistered = stopShortcutRegistered;
    unregisterStopShortcut();
    try {
      return await run();
    } finally {
      if (wasRegistered && session?.overlayShown) registerStopShortcut();
    }
  };

  const leaveOverlay = async (current: DrivingSession) => {
    if (!current.overlayShown) return;
    current.overlayShown = false;
    unregisterStopShortcut();
    const main = await mainWindow();
    main?.setContentProtection(false);
    overlay.hide(main);
  };

  const endSession = async (threadId: string, restoreHiddenApps: boolean) => {
    const current = session;
    if (current === undefined || current.threadId !== threadId) return;
    session = undefined;
    await leaveOverlay(current);
    if (!restoreHiddenApps) return;
    for (const hwnd of current.hidden.toReversed()) {
      if (await isMinimized(hwnd)) await restoreWithoutFocus(hwnd);
    }
  };

  const grantsFor = (threadId: string) => grantsByThread.get(threadId) ?? [];

  const isOwnWindow = (window: AppWindow | undefined) =>
    window !== undefined && window.processId === process.pid;

  const hideUngrantedApps = async (current: DrivingSession) => {
    const grants = grantsFor(current.threadId);
    let hidAny = false;
    for (const window of await listAppWindows()) {
      if (isOwnWindow(window) || findComputerUseGrant(grants, window) !== undefined) continue;
      if (await isMinimized(window.hwnd)) continue;
      await minimizeWithoutFocus(window.hwnd);
      current.hidden.push(window.hwnd);
      hidAny = true;
    }
    if (hidAny) await sleep(SETTLE_AFTER_HIDING_MS);
  };

  /** The first action that touches the screen starts driving mode. */
  const ensureDriving = async (threadId: string, agentName: string) => {
    if (session !== undefined && session.threadId !== threadId) {
      throw new ComputerUseRefusal(
        "Another Harp thread is using the computer right now. Try again when it finishes.",
      );
    }
    const current = session ?? { threadId, hidden: [], geometry: undefined, overlayShown: false };
    session = current;
    if (current.overlayShown) return current;
    current.overlayShown = true;
    const main = await mainWindow();
    main?.setContentProtection(true);
    await overlay.show(agentName, main);
    registerStopShortcut();
    await hideUngrantedApps(current);
    return current;
  };

  const currentGeometry = () => {
    const display = Electron.screen.getPrimaryDisplay();
    return screenGeometry(Electron.screen.dipToScreenRect(null, display.bounds));
  };

  const capture = async (current: DrivingSession): Promise<ComputerUseActionResult> => {
    const geometry = currentGeometry();
    const display = Electron.screen.getPrimaryDisplay();
    const sources = await Electron.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: geometry.imageWidth, height: geometry.imageHeight },
    });
    const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0];
    if (source === undefined)
      throw new ComputerUseRefusal("Windows did not offer a screen to capture.");
    let image = source.thumbnail;
    const size = image.getSize();
    if (size.width !== geometry.imageWidth || size.height !== geometry.imageHeight) {
      image = image.resize({
        width: geometry.imageWidth,
        height: geometry.imageHeight,
        quality: "best",
      });
    }
    current.geometry = geometry;
    const front = await foregroundAppWindow();
    return {
      text: `Screenshot of the primary display, ${geometry.imageWidth}x${geometry.imageHeight} pixels.${
        front && !isOwnWindow(front) ? ` Frontmost app: ${front.title || front.exeName}.` : ""
      }`,
      screenshot: {
        data: image.toJPEG(80).toString("base64"),
        mimeType: "image/jpeg",
        width: geometry.imageWidth,
        height: geometry.imageHeight,
      },
    };
  };

  const authorize = (
    threadId: string,
    action: ComputerUseAction,
    target: AppWindow | undefined,
  ) => {
    if (isOwnWindow(target)) {
      throw new ComputerUseRefusal("That point is Harp's own window, which the agent cannot use.");
    }
    const verdict = authorizeComputerUseAction({ action, target, grants: grantsFor(threadId) });
    if (!verdict.ok) throw new ComputerUseRefusal(verdict.message);
  };

  const physicalPoint = (current: DrivingSession, x: number, y: number) => {
    const geometry = current.geometry ?? currentGeometry();
    if (!isInsideImage(geometry, x, y)) {
      throw new ComputerUseRefusal(
        `(${x}, ${y}) is outside the ${geometry.imageWidth}x${geometry.imageHeight} screenshot.`,
      );
    }
    return imageToPhysical(geometry, x, y);
  };

  /** Runs a pointer action with the overlay letting clicks through to what lies beneath it. */
  const atPoint = async <A>(
    threadId: string,
    action: ComputerUseAction,
    point: { readonly x: number; readonly y: number },
    run: (target: AppWindow | undefined) => Promise<A>,
  ) => {
    overlay.passThrough(true);
    try {
      const target = await appWindowAtPoint(point.x, point.y);
      authorize(threadId, action, target);
      const result = await run(target);
      // SendInput only queues; let the click land before the overlay takes hits again.
      await sleep(60);
      return result;
    } finally {
      overlay.passThrough(false);
    }
  };

  const appLabel = (window: AppWindow | undefined) =>
    window ? window.title?.trim() || window.exeName : "the screen";

  const requestAccess = async (
    threadId: string,
    agentName: string,
    action: Extract<ComputerUseAction, { kind: "request_access" }>,
  ): Promise<ComputerUseActionResult> => {
    const existing = grantsFor(threadId);
    const wanted = action.apps
      .filter((app) => !existing.some((grant) => grant.app.toLowerCase() === app.toLowerCase()))
      .map((app) => ({ app, tier: computerUseTierForApp(app) }));
    if (wanted.length > 0) {
      const main = await mainWindow();
      const allowed = await askForComputerAccess({
        // A hidden parent would hide the dialog with it.
        parent: main?.isVisible() ? main : undefined,
        agentName,
        grants: wanted,
        reason: action.reason,
      });
      if (!allowed) {
        throw new ComputerUseRefusal(
          `The user denied access to ${wanted.map((grant) => grant.app).join(", ")}.`,
        );
      }
      grantsByThread.set(threadId, [...existing, ...wanted]);
    }
    return { text: `Granted: ${describeGrants(grantsFor(threadId))}.` };
  };

  const openApplication = async (
    threadId: string,
    name: string,
  ): Promise<ComputerUseActionResult> => {
    const grant =
      grantsFor(threadId).find((entry) => entry.app.toLowerCase() === name.toLowerCase()) ??
      grantsFor(threadId).find((entry) => computerUseGrantMatches(entry.app, { exeName: name }));
    if (grant === undefined) {
      throw new ComputerUseRefusal(`"${name}" has not been granted. Call request_access first.`);
    }
    let window = await findAppWindow(grant.app);
    let launchedAs: string | undefined;
    if (window === undefined) {
      launchedAs = await launchApp(grant.app);
      const deadline = Date.now() + APP_LAUNCH_TIMEOUT_MS;
      while (window === undefined && Date.now() < deadline) {
        await sleep(250);
        window = await findAppWindow(grant.app);
      }
    }
    if (window === undefined) {
      return {
        text: `Started ${launchedAs ?? grant.app}, but no window appeared yet. Take a screenshot to check.`,
      };
    }
    const focused = await bringToFront(window.hwnd);
    if (session) {
      const hidden = session.hidden.indexOf(window.hwnd);
      if (hidden >= 0) session.hidden.splice(hidden, 1);
    }
    return {
      text: `${launchedAs ? "Opened" : "Switched to"} ${appLabel(window)}${
        focused ? "" : " (Windows did not let it take focus; click it)"
      }.`,
    };
  };

  const perform = async (
    threadId: string,
    agentName: string,
    action: ComputerUseAction,
  ): Promise<ComputerUseActionResult> => {
    if (platform !== "win32") {
      throw new ComputerUseRefusal("Computer use is only available on Windows for now.");
    }
    switch (action.kind) {
      case "request_access":
        return requestAccess(threadId, agentName, action);
      case "list_granted_applications": {
        const grants = grantsFor(threadId);
        return {
          text: grants.length === 0 ? "No applications granted yet." : describeGrants(grants),
        };
      }
      case "screenshot":
        return capture(await ensureDriving(threadId, agentName));
      case "open_application":
        await ensureDriving(threadId, agentName);
        return openApplication(threadId, action.name);
      case "click": {
        const current = await ensureDriving(threadId, agentName);
        const modifiers = parseModifiers(action.modifiers);
        if (typeof modifiers === "string") throw new ComputerUseRefusal(modifiers);
        const point = physicalPoint(current, action.x, action.y);
        const input = await loadWindowsInputApi();
        const target = await atPoint(threadId, action, point, async (hit) => {
          input.setCursorPos(point.x, point.y);
          await sleep(30);
          await withoutStopShortcut(async () =>
            input.send(clickEvents(action.button, action.count, modifiers)),
          );
          return hit;
        });
        const verb =
          action.count === 1 ? "Clicked" : action.count === 2 ? "Double-clicked" : "Triple-clicked";
        return {
          text: `${verb} (${action.button}) at (${action.x}, ${action.y}) in ${appLabel(target)}.`,
        };
      }
      case "mouse_move": {
        const current = await ensureDriving(threadId, agentName);
        const point = physicalPoint(current, action.x, action.y);
        (await loadWindowsInputApi()).setCursorPos(point.x, point.y);
        return { text: `Moved the pointer to (${action.x}, ${action.y}).` };
      }
      case "left_click_drag": {
        const current = await ensureDriving(threadId, agentName);
        const from = physicalPoint(current, action.startX, action.startY);
        const to = physicalPoint(current, action.x, action.y);
        authorize(threadId, action, await appWindowAtPoint(to.x, to.y));
        const input = await loadWindowsInputApi();
        await atPoint(threadId, action, from, async () => {
          input.setCursorPos(from.x, from.y);
          await sleep(30);
          input.send([buttonEvent("left", false)]);
          for (let step = 1; step <= DRAG_STEPS; step += 1) {
            await sleep(16);
            input.setCursorPos(
              from.x + ((to.x - from.x) * step) / DRAG_STEPS,
              from.y + ((to.y - from.y) * step) / DRAG_STEPS,
            );
          }
          input.send([buttonEvent("left", true)]);
        });
        return {
          text: `Dragged from (${action.startX}, ${action.startY}) to (${action.x}, ${action.y}).`,
        };
      }
      case "scroll": {
        const current = await ensureDriving(threadId, agentName);
        const point = physicalPoint(current, action.x, action.y);
        const input = await loadWindowsInputApi();
        const target = await atPoint(threadId, action, point, async (hit) => {
          input.setCursorPos(point.x, point.y);
          await sleep(30);
          input.send(scrollEvents(action.direction, action.amount));
          return hit;
        });
        return { text: `Scrolled ${action.direction} ${action.amount} in ${appLabel(target)}.` };
      }
      case "type": {
        await ensureDriving(threadId, agentName);
        const target = await foregroundAppWindow();
        authorize(threadId, action, target);
        const input = await loadWindowsInputApi();
        // WinUI apps such as the new Paint drop Unicode keystrokes sent in one burst,
        // so each character goes as its own down/up pair with a short gap.
        const events = typeTextEvents(action.text);
        await withoutStopShortcut(async () => {
          for (let index = 0; index < events.length; index += 2) {
            input.send(events.slice(index, index + 2));
            await sleep(TYPE_INTERVAL_MS);
          }
        });
        return { text: `Typed ${action.text.length} characters into ${appLabel(target)}.` };
      }
      case "key": {
        await ensureDriving(threadId, agentName);
        const chord = parseChord(action.text);
        if (typeof chord === "string") throw new ComputerUseRefusal(chord);
        const target = await foregroundAppWindow();
        authorize(threadId, action, target);
        const input = await loadWindowsInputApi();
        await withoutStopShortcut(async () => {
          for (let index = 0; index < (action.repeat ?? 1); index += 1) {
            input.send(chordEvents(chord));
            if (index > 0) await sleep(20);
          }
        });
        return { text: `Pressed ${action.text} in ${appLabel(target)}.` };
      }
    }
  };

  const invoke = (command: Extract<ComputerUseCommandType, { type: "invoke" }>) => {
    const agentName = command.agentName?.trim() || "The agent";
    perform(command.threadId, agentName, command.action).then(
      (result) => emit({ type: "result", requestId: command.requestId, ok: true, result }),
      (error: unknown) =>
        emit({
          type: "result",
          requestId: command.requestId,
          ok: false,
          message:
            error instanceof ComputerUseRefusal
              ? error.message
              : `The desktop app could not complete ${command.action.kind}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
        }),
    );
  };

  const handleCommandLine = (line: string) =>
    Effect.sync(() => {
      const command = decodeCommand(line);
      if (Option.isNone(command)) return;
      if (command.value.type === "invoke") {
        invoke(command.value);
        return;
      }
      void endSession(command.value.threadId, command.value.restoreHiddenApps);
    });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unregisterStopShortcut();
      overlay.hide(undefined);
    }),
  );

  return ComputerUseHost.of({
    events: Stream.fromPubSub(outbox).pipe(
      Stream.map((event) => lineEncoder.encode(`${encodeEvent(event)}\n`)),
    ),
    handleCommandLine,
  });
});

const describeGrants = (grants: ReadonlyArray<ComputerUseGrant>) =>
  grants.map((grant) => `${grant.app} (${grant.tier})`).join(", ");

export const layer = Layer.effect(ComputerUseHost, make);
