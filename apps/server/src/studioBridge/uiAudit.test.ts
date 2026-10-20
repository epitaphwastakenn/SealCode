import { describe, expect, it } from "@effect/vitest";

import { auditUi, normalizeUi, type RawUiElement } from "./uiAudit.ts";

const viewport = { width: 800, height: 600, insetTopLeft: [0, 36], insetBottomRight: [0, 0] };

const screen: RawUiElement = {
  ref: "ir:s",
  path: "game.Players.P.PlayerGui.Hud",
  className: "ScreenGui",
  role: "viewport",
  enabled: true,
  zIndexBehavior: "Sibling",
};

const frame = (
  ref: string,
  rect: [number, number, number, number],
  extra: Partial<RawUiElement> = {},
): RawUiElement => ({
  ref,
  path: `game.Players.P.PlayerGui.Hud.${ref}`,
  className: "Frame",
  role: "container",
  semanticParentRef: "ir:s",
  visible: true,
  absolutePosition: [rect[0], rect[1]],
  absoluteSize: [rect[2], rect[3]],
  backgroundTransparency: 0,
  zIndex: 1,
  ...extra,
});

const label = (
  ref: string,
  rect: [number, number, number, number],
  extra: Partial<RawUiElement> = {},
): RawUiElement =>
  frame(ref, rect, {
    className: "TextLabel",
    role: "text",
    text: "Play",
    contentText: "Play",
    textBounds: [rect[2], rect[3]],
    textFits: true,
    textXAlignment: "Center",
    textYAlignment: "Center",
    backgroundTransparency: 1,
    textTransparency: 0,
    ...extra,
  });

const audit = (elements: RawUiElement[]) =>
  auditUi(normalizeUi({ elements: [screen, ...elements], viewport })).map((issue) => ({
    code: issue.code,
    ref: issue.ref,
    evidence: issue.evidence,
  }));

describe("normalizeUi", () => {
  it("computes the visible part of an element clipped by its parent and the viewport", () => {
    const [, parent, child] = normalizeUi({
      elements: [
        screen,
        frame("parent", [0, 0, 100, 100], { clipsDescendants: true }),
        frame("child", [50, 50, 100, 100], { semanticParentRef: "parent" }),
      ],
      viewport,
    });
    expect(parent!.effectiveVisible).toBe(true);
    expect(child!.visibleRect).toEqual({ x: 50, y: 50, w: 50, h: 50 });
    expect(child!.clippedByAncestor).toBe(true);
    expect(child!.visibleFraction).toBe(0.25);
  });

  it("hides everything under a disabled ScreenGui or an invisible ancestor", () => {
    const [, child] = normalizeUi({
      elements: [{ ...screen, enabled: false }, frame("child", [0, 0, 10, 10])],
      viewport,
    });
    expect(child!.effectiveVisible).toBe(false);
    expect(child!.visibleRect).toBeUndefined();
  });
});

describe("auditUi", () => {
  it("reports text that does not fit", () => {
    expect(audit([label("title", [10, 10, 100, 20], { textFits: false })])).toEqual([
      { code: "text_overflow", ref: "title", evidence: { fits: false } },
    ]);
  });

  it("reports text covered by a sibling drawn above it", () => {
    const issues = audit([
      label("title", [100, 100, 100, 20]),
      frame("overlay", [100, 100, 200, 200], { zIndex: 5 }),
    ]);
    expect(issues).toEqual([
      {
        code: "text_obscured",
        ref: "title",
        evidence: { coveredBy: "game.Players.P.PlayerGui.Hud.overlay", coveredShare: 1 },
      },
    ]);
  });

  it("reports text half on a painted panel it draws above", () => {
    const issues = audit([
      label("title", [100, 100, 100, 20], { zIndex: 3 }),
      frame("panel", [150, 0, 300, 300], { zIndex: 1 }),
    ]);
    expect(issues).toEqual([
      {
        code: "text_straddles_edge",
        ref: "title",
        evidence: {
          over: "game.Players.P.PlayerGui.Hud.panel",
          shareOn: 0.5,
          drawOrder: "text above",
        },
      },
    ]);
  });

  it("ignores a drop-shadow copy of the same text", () => {
    expect(
      audit([
        label("title", [100, 100, 100, 20], { zIndex: 2 }),
        label("shadow", [102, 102, 100, 20], { zIndex: 3 }),
      ]),
    ).toEqual([]);
  });

  it("reports content past the end of a scrolling canvas once, at the outermost element", () => {
    const issues = audit([
      frame("list", [0, 0, 200, 200], {
        className: "ScrollingFrame",
        role: "scroll_container",
        canvasPosition: [0, 0],
        absoluteCanvasSize: [200, 300],
        absoluteWindowSize: [200, 200],
      }),
      frame("row", [0, 280, 200, 60], { semanticParentRef: "list" }),
      frame("rowIcon", [0, 300, 20, 30], { semanticParentRef: "row" }),
    ]);
    expect(issues).toContainEqual({
      code: "content_beyond_scroll",
      ref: "row",
      evidence: {
        scrollingFrame: "game.Players.P.PlayerGui.Hud.list",
        pastBottom: 40,
        pastRight: 0,
      },
    });
    expect(issues.filter((issue) => issue.code === "content_beyond_scroll")).toHaveLength(1);
  });

  it("reports an element off screen that no scrolling can reach", () => {
    expect(audit([frame("lost", [900, 100, 50, 50])])).toEqual([
      { code: "element_outside_viewport", ref: "lost", evidence: { rect: [900, 100, 50, 50] } },
    ]);
  });
});
