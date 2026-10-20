/**
 * Turns the raw facts the plugin collects from a playtest client's PlayerGui into what an agent
 * can act on: effective visibility, the rectangle actually on screen, clipping and scrolling, and
 * an audit of the defects the roblox-gui skill asks agents to fix. Text is judged by where its
 * letters are drawn (its ink), not by the label's box.
 */

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export interface RawUiElement {
  readonly ref: string;
  readonly path?: string;
  readonly name?: string;
  readonly className: string;
  readonly role?: string;
  readonly depth?: number;
  readonly parentRef?: string;
  readonly semanticParentRef?: string;
  readonly visible?: boolean;
  readonly enabled?: boolean;
  readonly zIndexBehavior?: string;
  readonly absolutePosition?: ReadonlyArray<number>;
  readonly absoluteSize?: ReadonlyArray<number>;
  readonly active?: boolean;
  readonly engineInteractable?: boolean;
  readonly zIndex?: number;
  readonly backgroundTransparency?: number;
  readonly imageTransparency?: number;
  readonly clipsDescendants?: boolean;
  readonly text?: string;
  readonly contentText?: string;
  readonly textBounds?: ReadonlyArray<number>;
  readonly textFits?: boolean;
  readonly textWrapped?: boolean;
  readonly textScaled?: boolean;
  readonly textTransparency?: number;
  readonly textXAlignment?: string;
  readonly textYAlignment?: string;
  readonly canvasPosition?: ReadonlyArray<number>;
  readonly absoluteCanvasSize?: ReadonlyArray<number>;
  readonly absoluteWindowSize?: ReadonlyArray<number>;
  readonly [key: string]: unknown;
}

export interface RawUiViewport {
  readonly width: number;
  readonly height: number;
  readonly insetTopLeft: ReadonlyArray<number>;
  readonly insetBottomRight?: ReadonlyArray<number>;
}

export interface UiIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly ref: string;
  readonly path?: string;
  readonly message: string;
  readonly evidence: Record<string, unknown>;
}

const MIN_INK_AREA = 16;
const MIN_SHARE = 0.15;
const PAINT_LIMIT = 0.95;
const ON_SHARE = 0.9;
const SHADOW_OFFSET = 6;
const SCROLL_TOLERANCE = 2;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const pair = (value: ReadonlyArray<number> | undefined): readonly [number, number] | undefined =>
  value !== undefined && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : undefined;

const area = (rect: Rect | undefined): number =>
  rect === undefined ? 0 : Math.max(rect.w, 0) * Math.max(rect.h, 0);

const intersect = (a: Rect | undefined, b: Rect | undefined): Rect | undefined => {
  if (a === undefined || b === undefined) return undefined;
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
};

const contains = (outer: Rect, inner: Rect, tolerance = 0): boolean =>
  inner.x >= outer.x - tolerance &&
  inner.y >= outer.y - tolerance &&
  inner.x + inner.w <= outer.x + outer.w + tolerance &&
  inner.y + inner.h <= outer.y + outer.h + tolerance;

const asArray = (rect: Rect | undefined) =>
  rect === undefined ? null : [round(rect.x), round(rect.y), round(rect.w), round(rect.h)];

const round = (value: number) => Math.round(value * 100) / 100;

const isText = (element: RawUiElement) =>
  element.className === "TextLabel" ||
  element.className === "TextButton" ||
  element.className === "TextBox";

const isImage = (element: RawUiElement) =>
  element.className === "ImageLabel" || element.className === "ImageButton";

const paints = (element: RawUiElement) =>
  (finite(element.backgroundTransparency) && element.backgroundTransparency < PAINT_LIMIT) ||
  (isImage(element) &&
    finite(element.imageTransparency) &&
    element.imageTransparency < PAINT_LIMIT);

export interface NormalizedUiElement {
  readonly raw: RawUiElement;
  readonly rect: Rect | undefined;
  readonly invalidGeometry: boolean;
  readonly lineage: ReadonlyArray<RawUiElement>;
  readonly effectiveVisible: boolean;
  readonly visibleRect: Rect | undefined;
  readonly insideViewport: boolean;
  readonly clipped: boolean;
  readonly clippedByAncestor: boolean;
  readonly inScrollingWindow: boolean;
  readonly requiresScrolling: boolean;
  readonly visibleFraction: number;
  readonly interactable: boolean;
  readonly ink: Rect | undefined;
}

const rectOf = (element: RawUiElement): { rect: Rect | undefined; invalid: boolean } => {
  if (element.absolutePosition === undefined && element.absoluteSize === undefined) {
    return { rect: undefined, invalid: false };
  }
  const position = pair(element.absolutePosition);
  const size = pair(element.absoluteSize);
  if (position === undefined || size === undefined || size[0] < 0 || size[1] < 0) {
    return { rect: undefined, invalid: true };
  }
  return { rect: { x: position[0], y: position[1], w: size[0], h: size[1] }, invalid: false };
};

/** Where the letters are drawn: TextBounds placed by alignment inside the box. */
const inkOf = (element: RawUiElement, rect: Rect | undefined): Rect | undefined => {
  const bounds = pair(element.textBounds);
  if (rect === undefined || bounds === undefined || !isText(element)) return undefined;
  const text = element.contentText ?? element.text;
  if (typeof text === "string" && text.trim() === "") return undefined;
  const w = Math.min(bounds[0], rect.w);
  const h = Math.min(bounds[1], rect.h);
  const x =
    element.textXAlignment === "Left"
      ? rect.x
      : element.textXAlignment === "Right"
        ? rect.x + rect.w - w
        : rect.x + (rect.w - w) / 2;
  const y =
    element.textYAlignment === "Top"
      ? rect.y
      : element.textYAlignment === "Bottom"
        ? rect.y + rect.h - h
        : rect.y + (rect.h - h) / 2;
  return { x, y, w, h };
};

export const normalizeUi = (input: {
  readonly elements: ReadonlyArray<RawUiElement>;
  readonly context?: ReadonlyArray<RawUiElement>;
  readonly viewport: RawUiViewport;
}): ReadonlyArray<NormalizedUiElement> => {
  const byRef = new Map<string, RawUiElement>();
  for (const element of [...(input.context ?? []), ...input.elements])
    byRef.set(element.ref, element);
  const inset = pair(input.viewport.insetTopLeft) ?? [0, 0];
  const viewportRect: Rect = {
    x: -inset[0],
    y: -inset[1],
    w: input.viewport.width,
    h: input.viewport.height,
  };

  const lineageOf = (element: RawUiElement): RawUiElement[] => {
    const chain: RawUiElement[] = [];
    const seen = new Set<string>([element.ref]);
    let parentRef = element.semanticParentRef ?? element.parentRef;
    while (parentRef !== undefined && !seen.has(parentRef)) {
      seen.add(parentRef);
      const parent = byRef.get(parentRef);
      if (parent === undefined) break;
      chain.push(parent);
      parentRef = parent.semanticParentRef ?? parent.parentRef;
    }
    return chain;
  };

  return input.elements.map((raw) => {
    const { rect, invalid } = rectOf(raw);
    const lineage = lineageOf(raw);
    const hidden = (element: RawUiElement) =>
      element.visible === false || (element.className === "ScreenGui" && element.enabled === false);
    const effectiveVisible = !hidden(raw) && !lineage.some(hidden);
    let visibleRect: Rect | undefined;
    let clipped = false;
    let clippedByAncestor = false;
    let inScrollingWindow = false;
    let requiresScrolling = false;
    let insideViewport = false;
    if (rect !== undefined && effectiveVisible) {
      visibleRect = intersect(rect, viewportRect);
      insideViewport = visibleRect !== undefined;
      clipped = visibleRect === undefined || area(visibleRect) < area(rect);
      for (const ancestor of lineage) {
        const scroller = ancestor.className === "ScrollingFrame";
        if (!scroller && ancestor.clipsDescendants !== true) continue;
        const { rect: ancestorRect } = rectOf(ancestor);
        if (ancestorRect === undefined) continue;
        const window = pair(ancestor.absoluteWindowSize);
        const clipRect =
          scroller && window !== undefined
            ? { x: ancestorRect.x, y: ancestorRect.y, w: window[0], h: window[1] }
            : ancestorRect;
        const before = visibleRect;
        visibleRect = intersect(visibleRect, clipRect);
        if (area(visibleRect) < area(before)) {
          clipped = true;
          clippedByAncestor = true;
        }
        if (scroller) {
          inScrollingWindow = true;
          if (!contains(clipRect, rect)) requiresScrolling = true;
        }
      }
    }
    const visibleFraction =
      area(rect) > 0 ? Math.min(Math.max(area(visibleRect) / area(rect), 0), 1) : 0;
    const role = raw.role ?? "container";
    const interactable =
      (role === "button" || role === "input") &&
      raw.engineInteractable !== false &&
      raw.active !== false &&
      raw.inputActionable !== false &&
      visibleRect !== undefined;
    const ink = effectiveVisible ? intersect(inkOf(raw, rect), visibleRect) : undefined;
    return {
      raw,
      rect,
      invalidGeometry: invalid,
      lineage,
      effectiveVisible,
      visibleRect,
      insideViewport,
      clipped,
      clippedByAncestor,
      inScrollingWindow,
      requiresScrolling,
      visibleFraction,
      interactable,
      ink,
    };
  });
};

/** Whether `a` draws above `b`; undefined when ZIndex cannot tell them apart. */
const drawsAbove = (a: NormalizedUiElement, b: NormalizedUiElement): boolean | undefined => {
  const chainA = [a.raw, ...a.lineage];
  const chainB = [b.raw, ...b.lineage];
  const refsB = new Map(chainB.map((element, index) => [element.ref, index]));
  let common = -1;
  let commonInB = -1;
  for (let i = 0; i < chainA.length; i += 1) {
    const j = refsB.get(chainA[i]!.ref);
    if (j !== undefined) {
      common = i;
      commonInB = j;
      break;
    }
  }
  if (common < 0) return undefined;
  const screen = [...chainA].reverse().find((element) => element.className === "ScreenGui");
  const zOf = (element: RawUiElement | undefined) => (finite(element?.zIndex) ? element.zIndex : 1);
  const [za, zb] =
    screen?.zIndexBehavior === "Global"
      ? [zOf(a.raw), zOf(b.raw)]
      : [zOf(chainA[common - 1]), zOf(chainB[commonInB - 1])];
  return za === zb ? undefined : za > zb;
};

const isAncestorOf = (maybeAncestor: NormalizedUiElement, element: NormalizedUiElement) =>
  element.lineage.some((ancestor) => ancestor.ref === maybeAncestor.raw.ref);

const label = (element: NormalizedUiElement) => element.raw.path ?? element.raw.ref;

export const auditUi = (elements: ReadonlyArray<NormalizedUiElement>): ReadonlyArray<UiIssue> => {
  const issues: UiIssue[] = [];
  const issue = (
    element: NormalizedUiElement,
    severity: UiIssue["severity"],
    code: string,
    message: string,
    evidence: Record<string, unknown>,
  ) =>
    issues.push({
      severity,
      code,
      ref: element.raw.ref,
      ...(element.raw.path === undefined ? {} : { path: element.raw.path }),
      message,
      evidence,
    });

  for (const element of elements) {
    const raw = element.raw;
    if (element.invalidGeometry) {
      issue(
        element,
        "error",
        "invalid_rendered_geometry",
        "Position or size is missing or not a usable number.",
        {
          rect: asArray(element.rect),
        },
      );
    }
    if (raw.className === "ScrollingFrame") {
      const bad = ["canvasPosition", "absoluteCanvasSize", "absoluteWindowSize"].some((key) => {
        const value = raw[key] as ReadonlyArray<number> | undefined;
        if (value === undefined) return false;
        const parsed = pair(value);
        return parsed === undefined || parsed[0] < 0 || parsed[1] < 0;
      });
      if (bad) {
        issue(
          element,
          "error",
          "invalid_scroll_geometry",
          "The scrolling frame's canvas or window size is not usable.",
          {
            canvasPosition: raw.canvasPosition,
            absoluteCanvasSize: raw.absoluteCanvasSize,
            absoluteWindowSize: raw.absoluteWindowSize,
          },
        );
      }
    }
    if (isText(raw) && raw.textFits === false && element.effectiveVisible) {
      issue(
        element,
        "warning",
        "text_overflow",
        "The text does not fit its box; it is cut off or spills out.",
        {
          fits: false,
        },
      );
    }
    const interactiveRole = raw.role === "button" || raw.role === "input";
    if (
      interactiveRole &&
      element.effectiveVisible &&
      element.rect !== undefined &&
      (element.rect.w === 0 || element.rect.h === 0)
    ) {
      issue(
        element,
        "warning",
        "zero_size_interactive",
        "A button or text box has zero width or height.",
        {
          rect: asArray(element.rect),
        },
      );
    }
    if (element.effectiveVisible && area(element.rect) > 0 && !element.insideViewport) {
      const scrollerRef = element.lineage.find(
        (ancestor) => ancestor.className === "ScrollingFrame",
      )?.ref;
      const scroller = elements.find((candidate) => candidate.raw.ref === scrollerRef);
      const canvas = scroller === undefined ? undefined : canvasRect(scroller);
      const reachable =
        scroller !== undefined &&
        scroller.insideViewport &&
        canvas !== undefined &&
        element.rect !== undefined &&
        contains(canvas, element.rect, SCROLL_TOLERANCE);
      if (!reachable) {
        issue(
          element,
          "warning",
          "element_outside_viewport",
          "The element is entirely off screen and cannot be scrolled into view.",
          {
            rect: asArray(element.rect),
          },
        );
      }
    }
    if (
      interactiveRole &&
      element.effectiveVisible &&
      element.clippedByAncestor &&
      element.visibleRect === undefined &&
      !element.requiresScrolling
    ) {
      issue(
        element,
        "warning",
        "fully_clipped_interactive",
        "A button or text box is clipped away entirely by an ancestor.",
        {
          rect: asArray(element.rect),
        },
      );
    }
  }

  // Text that another element covers, or that sits half on and half off a painted shape.
  for (const text of elements) {
    if (!isText(text.raw) || text.ink === undefined || area(text.ink) < MIN_INK_AREA) continue;
    if (finite(text.raw.textTransparency) && text.raw.textTransparency >= PAINT_LIMIT) continue;
    let cover: { element: NormalizedUiElement; share: number } | undefined;
    let straddle: { element: NormalizedUiElement; share: number; order: string } | undefined;
    for (const other of elements) {
      if (other === text || !other.effectiveVisible || other.visibleRect === undefined) continue;
      if (isAncestorOf(other, text) || isAncestorOf(text, other)) continue;
      const otherPaints = paints(other.raw);
      const otherInk =
        isText(other.raw) &&
        !(finite(other.raw.textTransparency) && other.raw.textTransparency >= PAINT_LIMIT)
          ? other.ink
          : undefined;
      if (!otherPaints && otherInk === undefined) continue;
      // A drop-shadow label: unpainted, same text or size, nudged a few pixels.
      if (
        !otherPaints &&
        isText(other.raw) &&
        other.rect !== undefined &&
        text.rect !== undefined
      ) {
        const sameText =
          (other.raw.contentText ?? other.raw.text) === (text.raw.contentText ?? text.raw.text);
        const sameSize =
          Math.abs(other.rect.w - text.rect.w) <= 2 && Math.abs(other.rect.h - text.rect.h) <= 2;
        if (
          (sameText || sameSize) &&
          Math.abs(other.rect.x - text.rect.x) <= SHADOW_OFFSET &&
          Math.abs(other.rect.y - text.rect.y) <= SHADOW_OFFSET
        ) {
          continue;
        }
      }
      const paintRect = otherPaints ? other.visibleRect : otherInk;
      const share = area(intersect(text.ink, paintRect)) / area(text.ink);
      if (share < MIN_SHARE) continue;
      const above = drawsAbove(other, text);
      if (above === true) {
        if (cover === undefined || share > cover.share) cover = { element: other, share };
      } else if (otherPaints && share < ON_SHARE) {
        if (straddle === undefined || share > straddle.share) {
          straddle = {
            element: other,
            share,
            order: above === false ? "text above" : "unknown (equal ZIndex)",
          };
        }
      }
    }
    if (cover !== undefined) {
      issue(
        text,
        "warning",
        "text_obscured",
        `Another element draws over ${Math.round(cover.share * 100)}% of this text.`,
        {
          coveredBy: label(cover.element),
          coveredShare: round(cover.share),
        },
      );
    } else if (straddle !== undefined) {
      issue(
        text,
        "warning",
        "text_straddles_edge",
        "The text sits partly on and partly off a painted element.",
        {
          over: label(straddle.element),
          shareOn: round(straddle.share),
          drawOrder: straddle.order,
        },
      );
    }
  }

  // Content that reaches past its scrolling frame's canvas, reported once at the outermost offender.
  const reported = new Set<string>();
  for (const element of elements) {
    if (!element.effectiveVisible || element.rect === undefined) continue;
    const scrollerRaw = element.lineage.find((ancestor) => ancestor.className === "ScrollingFrame");
    if (scrollerRaw === undefined) continue;
    const scroller = elements.find((candidate) => candidate.raw.ref === scrollerRaw.ref);
    const canvas = scroller === undefined ? undefined : canvasRect(scroller);
    if (canvas === undefined) continue;
    const pastBottom = element.rect.y + element.rect.h - (canvas.y + canvas.h);
    const pastRight = element.rect.x + element.rect.w - (canvas.x + canvas.w);
    if (pastBottom <= SCROLL_TOLERANCE && pastRight <= SCROLL_TOLERANCE) continue;
    const between = element.lineage.slice(0, element.lineage.indexOf(scrollerRaw));
    if (between.some((ancestor) => reported.has(ancestor.ref))) continue;
    reported.add(element.raw.ref);
    issue(
      element,
      "warning",
      "content_beyond_scroll",
      "Part of this element lies past the end of its scrolling canvas, so it can never be scrolled into view.",
      {
        scrollingFrame: label(scroller!),
        pastBottom: Math.max(0, Math.round(pastBottom)),
        pastRight: Math.max(0, Math.round(pastRight)),
      },
    );
  }

  return issues.toSorted(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.code.localeCompare(b.code) ||
      (a.path ?? "").localeCompare(b.path ?? "") ||
      a.ref.localeCompare(b.ref),
  );
};

const canvasRect = (scroller: NormalizedUiElement): Rect | undefined => {
  const position = pair(scroller.raw.canvasPosition) ?? [0, 0];
  const size = pair(scroller.raw.absoluteCanvasSize);
  if (scroller.rect === undefined || size === undefined) return undefined;
  return {
    x: scroller.rect.x - position[0],
    y: scroller.rect.y - position[1],
    w: size[0],
    h: size[1],
  };
};

/** The element as the agent sees it: identity, role, geometry and the raw facts that matter. */
export const presentElement = (element: NormalizedUiElement, mode: "inspect" | "snapshot") => {
  const raw = element.raw;
  const geometry = {
    rect: asArray(element.rect),
    visibleRect: asArray(element.visibleRect),
    effectiveVisible: element.effectiveVisible,
    visibleFraction: round(element.visibleFraction),
    insideViewport: element.insideViewport,
    clipped: element.clipped,
    inScrollingWindow: element.inScrollingWindow,
    requiresScrolling: element.requiresScrolling,
    interactable: element.interactable,
  };
  const text = raw.contentText ?? raw.text;
  if (mode === "snapshot") {
    return {
      ref: raw.ref,
      path: raw.path,
      className: raw.className,
      role: raw.role,
      ...geometry,
      ...(text === undefined ? {} : { text }),
    };
  }
  const { absolutePosition: _p, absoluteSize: _s, semanticParentRef: _sp, ...facts } = raw;
  return {
    ...facts,
    ...geometry,
    ...(element.invalidGeometry ? { hasInvalidRenderedGeometry: true } : {}),
  };
};
