import { describe, expect, it } from "vite-plus/test";

import type { ComputerUseAction, ComputerUseGrant } from "@t3tools/contracts";

import {
  authorizeComputerUseAction,
  computerUseGrantMatches,
  computerUseTierForApp,
} from "./computerUse.ts";

const click = (overrides: Partial<Extract<ComputerUseAction, { kind: "click" }>> = {}) =>
  ({ kind: "click", button: "left", count: 1, x: 10, y: 10, ...overrides }) as const;

const grants: ReadonlyArray<ComputerUseGrant> = [
  { app: "Paint", tier: "full" },
  { app: "Visual Studio Code", tier: "click" },
  { app: "Google Chrome", tier: "read" },
];

describe("computerUseTierForApp", () => {
  it("restricts browsers to reading and terminals or IDEs to clicking", () => {
    expect(computerUseTierForApp("Google Chrome")).toBe("read");
    expect(computerUseTierForApp("msedge.exe")).toBe("read");
    expect(computerUseTierForApp("Windows Terminal")).toBe("click");
    expect(computerUseTierForApp("Visual Studio Code")).toBe("click");
    expect(computerUseTierForApp("Paint")).toBe("full");
    expect(computerUseTierForApp("Notepad")).toBe("full");
  });
});

describe("computerUseGrantMatches", () => {
  it("maps display names to their executables", () => {
    expect(computerUseGrantMatches("Paint", { exeName: "mspaint.exe" })).toBe(true);
    expect(computerUseGrantMatches("Calculator", { exeName: "CalculatorApp.exe" })).toBe(true);
    expect(computerUseGrantMatches("Notepad++", { exeName: "notepad++.exe" })).toBe(true);
    expect(computerUseGrantMatches("Paint", { exeName: "notepad.exe" })).toBe(false);
  });

  it("tells UWP frame windows apart by title", () => {
    const frame = { exeName: "ApplicationFrameHost.exe", title: "Calculator" };
    expect(computerUseGrantMatches("Calculator", frame)).toBe(true);
    expect(computerUseGrantMatches("Settings", frame)).toBe(false);
  });

  it("does not match short names by containment", () => {
    expect(computerUseGrantMatches("cmd", { exeName: "cmdagent.exe" })).toBe(false);
  });
});

describe("authorizeComputerUseAction", () => {
  const paint = { exeName: "mspaint.exe", title: "Untitled - Paint" };
  const code = { exeName: "Code.exe", title: "main.ts - Visual Studio Code" };
  const chrome = { exeName: "chrome.exe", title: "New Tab - Google Chrome" };

  it("allows every action on a full-tier app", () => {
    for (const action of [
      click(),
      click({ button: "right" }),
      { kind: "type", text: "Oi" } as const,
      { kind: "key", text: "ctrl+s" } as const,
      { kind: "left_click_drag", startX: 0, startY: 0, x: 5, y: 5 } as const,
    ]) {
      expect(authorizeComputerUseAction({ action, target: paint, grants }).ok).toBe(true);
    }
  });

  it("limits click-tier apps to plain left clicks and scrolling", () => {
    const allowed = [
      click(),
      click({ count: 2 }),
      { kind: "scroll", x: 1, y: 1, direction: "down", amount: 3 } as const,
    ];
    for (const action of allowed) {
      expect(authorizeComputerUseAction({ action, target: code, grants }).ok).toBe(true);
    }
    const blocked = [
      click({ button: "right" }),
      click({ modifiers: "ctrl" }),
      { kind: "type", text: "rm -rf" } as const,
      { kind: "key", text: "Return" } as const,
    ];
    for (const action of blocked) {
      const result = authorizeComputerUseAction({ action, target: code, grants });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain('tier "click"');
    }
  });

  it("blocks input on read-tier apps", () => {
    const result = authorizeComputerUseAction({ action: click(), target: chrome, grants });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("browser tools");
  });

  it("asks for access when the target app was never granted", () => {
    const result = authorizeComputerUseAction({
      action: click(),
      target: { exeName: "notepad.exe", title: "Notes" },
      grants,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("request_access");
  });

  it("needs no target for screenshots and pointer moves", () => {
    for (const action of [
      { kind: "screenshot" } as const,
      { kind: "mouse_move", x: 3, y: 4 } as const,
    ]) {
      expect(authorizeComputerUseAction({ action, target: undefined, grants: [] }).ok).toBe(true);
    }
  });
});
