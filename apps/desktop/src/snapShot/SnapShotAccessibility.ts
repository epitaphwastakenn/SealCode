// @effect-diagnostics globalTimers:off -- Accessibility timeouts run outside Effect fibers.

import {
  SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS,
  type SnapShotAccessibility,
} from "@t3tools/contracts";
import type * as Electron from "electron";

import {
  accessibleWindowElementTree,
  accessibleWindowText,
  compactAccessibilityTree,
  findAccessibleWindow,
} from "./snapShot.ts";

const ACCESSIBILITY_TIMEOUT_MS = 3_000;

export type AccessibleWindowIdentity = {
  readonly title: string;
  readonly bounds: Electron.Rectangle;
  readonly owner: { readonly processId: number; readonly bundleId?: string };
};

export type CapturedWindowAccessibilityContext = {
  readonly accessibleText?: string;
  readonly accessibility?: SnapShotAccessibility;
};

export type SnapShotAccessibilityRequest = {
  readonly active: AccessibleWindowIdentity;
  readonly platform: NodeJS.Platform;
  readonly sourceTitle: string;
  readonly imageSize: Electron.Size;
};

type AccessibilityApp = (typeof import("@crowecawcaw/xa11y"))["App"];

type AccessibilityReadProgress = {
  accessibleText: string | undefined;
  flatComplete: boolean;
  richComplete: boolean;
  richRoot?: Extract<SnapShotAccessibility, { format: "element-tree" }>["root"];
  richTruncated: boolean;
  timedOut: boolean;
};

function accessibilityReadSnapshot(
  progress: AccessibilityReadProgress,
  imageSize: Electron.Size,
): CapturedWindowAccessibilityContext | undefined {
  const richTree = progress.richRoot ? compactAccessibilityTree(progress.richRoot) : undefined;
  const richText = richTree
    ? accessibleWindowText(richTree.root, SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS)
    : undefined;
  const accessibleText = progress.accessibleText ?? richText;
  const richTruncated = progress.richTruncated || richTree?.truncated === true;
  const accessibility: SnapShotAccessibility | undefined =
    progress.richComplete &&
    richTree &&
    (!richTruncated || !progress.accessibleText || progress.accessibleText === richText)
      ? {
          format: "element-tree",
          coordinateSpace: "captured-image",
          imageSize,
          truncated: richTruncated,
          root: richTree.root,
        }
      : progress.flatComplete && progress.accessibleText
        ? {
            format: "flat-text",
            text: progress.accessibleText,
            truncated: progress.accessibleText.length >= SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS,
          }
        : richTree
          ? {
              format: "element-tree",
              coordinateSpace: "captured-image",
              imageSize,
              truncated: true,
              root: richTree.root,
            }
          : undefined;
  if (!accessibleText && !accessibility) return undefined;
  return JSON.parse(
    JSON.stringify({
      ...(accessibleText ? { accessibleText } : {}),
      ...(accessibility ? { accessibility } : {}),
    }),
  ) as CapturedWindowAccessibilityContext;
}

type AccessibilityElement = Awaited<ReturnType<InstanceType<AccessibilityApp>["children"]>>[number];

async function windowsForPid(
  App: AccessibilityApp,
  processId: number,
): Promise<readonly AccessibilityElement[]> {
  return await App.byPid(processId, { timeout: 0 })
    .then((app) => app.children())
    .catch(() => []);
}

async function readCapturedWindowAccessibility(
  App: AccessibilityApp,
  request: SnapShotAccessibilityRequest,
  progress: AccessibilityReadProgress,
  onStarted: () => void,
): Promise<CapturedWindowAccessibilityContext | undefined> {
  const { active, platform, sourceTitle, imageSize } = request;
  const foreground = platform === "win32" ? await App.foreground({ timeout: 0 }) : undefined;
  const pidWindows =
    foreground !== undefined
      ? foreground.pid === active.owner.processId
        ? [foreground.asElement()]
        : []
      : await windowsForPid(App, active.owner.processId);
  const captured = {
    title: active.title,
    sourceTitle,
    bounds: active.bounds,
    platform,
    bundleId: pidWindows.length > 0 ? active.owner.bundleId : undefined,
  };
  const window = findAccessibleWindow(pidWindows, captured, {
    allowUntitledUniqueBounds: foreground === undefined && pidWindows.length > 0,
  });
  if (!window) {
    onStarted();
    return undefined;
  }
  const accessibleBounds = window.bounds;
  const flatRead = window
    .tree()
    .then((tree) => {
      progress.accessibleText =
        accessibleWindowText(tree, SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS) || undefined;
      progress.flatComplete = true;
    })
    .catch(() => {
      progress.flatComplete = true;
    });
  // Preserve the screenshot frame origin and scale so accessibility coordinates include decorations.
  const sourceBounds = accessibleBounds ?? active.bounds;
  const richRead = accessibleWindowElementTree(window, sourceBounds, imageSize, {
    onProgress: (root, truncated) => {
      progress.richRoot = root;
      progress.richTruncated = truncated;
    },
    shouldContinue: () => !progress.timedOut,
  })
    .then((rich) => {
      progress.richComplete = true;
      if (rich) {
        progress.richRoot = rich.root;
        progress.richTruncated = rich.truncated;
      }
    })
    .catch(() => {
      progress.richComplete = true;
    });
  onStarted();
  await Promise.all([flatRead, richRead]);
  return accessibilityReadSnapshot(progress, imageSize);
}

let activeAccessibilityRead: Promise<unknown> | undefined;

async function raceAccessibleRead<T>(
  run: () => Promise<T>,
  timeoutValue: () => T | undefined,
): Promise<T | undefined> {
  if (activeAccessibilityRead) return undefined;
  const read = run().catch(() => undefined);
  activeAccessibilityRead = read;
  void read.finally(() => {
    if (activeAccessibilityRead === read) activeAccessibilityRead = undefined;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<T | undefined>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutValue()), ACCESSIBILITY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function readAccessibleWindowContextWithApp(
  App: AccessibilityApp,
  request: SnapShotAccessibilityRequest,
  onStarted: () => void = () => undefined,
): Promise<CapturedWindowAccessibilityContext | undefined> {
  const progress: AccessibilityReadProgress = {
    accessibleText: undefined,
    flatComplete: false,
    richComplete: false,
    richTruncated: false,
    timedOut: false,
  };
  return raceAccessibleRead(
    () => readCapturedWindowAccessibility(App, request, progress, onStarted),
    () => {
      progress.timedOut = true;
      return accessibilityReadSnapshot(progress, request.imageSize);
    },
  );
}
