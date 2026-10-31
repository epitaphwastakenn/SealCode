import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyTerminalAttachStreamEvent,
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  nextTerminalAttachSeedState,
} from "@t3tools/client-runtime/state/terminal";

import {
  deriveTerminalPalette,
  shouldClearTerminalSelectionAction,
  shouldHandleTerminalExit,
  synchronizeTerminalOutput,
} from "./ThreadTerminalDrawer";

describe("terminal selection actions", () => {
  it("does not let an old selection popup cancel its replacement right-click menu", () => {
    expect(
      shouldClearTerminalSelectionAction({
        actionPending: false,
        openMenuRequestId: 3,
        currentRequestId: 4,
      }),
    ).toBe(false);
    expect(
      shouldClearTerminalSelectionAction({
        actionPending: false,
        openMenuRequestId: null,
        currentRequestId: 4,
      }),
    ).toBe(false);
  });

  it("handles an exit that lands while the terminal surface is still loading", () => {
    expect(shouldHandleTerminalExit("exited", "running", false, 1)).toBe(true);
    expect(shouldHandleTerminalExit("exited", "exited", false, 1)).toBe(false);
    expect(shouldHandleTerminalExit("closed", "running", true, 1)).toBe(false);
  });
});

it("retains visible output and selection until a replacement subscription receives its snapshot", () => {
  const terminal = { resetAndWrite: vi.fn(), write: vi.fn(), clearSelection: vi.fn() };
  const snapshot = {
    threadId: "thread",
    terminalId: "term-1",
    cwd: "/repo",
    worktreePath: null,
    status: "running" as const,
    pid: 123,
    history: "host output",
    exitCode: null,
    exitSignal: null,
    label: "Terminal 1",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
  const attached = applyTerminalAttachStreamEvent(nextTerminalAttachSeedState(), {
    type: "snapshot",
    snapshot,
  });
  const cursor = synchronizeTerminalOutput(terminal, attached, INITIAL_TERMINAL_OUTPUT_CURSOR);
  expect(terminal.resetAndWrite).toHaveBeenLastCalledWith("host output");
  terminal.resetAndWrite.mockClear();
  terminal.clearSelection.mockClear();

  const pending = combineTerminalSessionState(
    { ...snapshot, hasRunningSubprocess: false },
    EMPTY_TERMINAL_BUFFER_STATE,
  );
  expect(pending.status).toBe("running");
  expect(synchronizeTerminalOutput(terminal, pending, cursor)).toBe(cursor);
  expect(terminal.resetAndWrite).not.toHaveBeenCalled();
  expect(terminal.write).not.toHaveBeenCalled();
  expect(terminal.clearSelection).not.toHaveBeenCalled();

  const observed = applyTerminalAttachStreamEvent(nextTerminalAttachSeedState(), {
    type: "snapshot",
    snapshot: { ...snapshot, history: "host output\nobserved output" },
  });
  const observedCursor = synchronizeTerminalOutput(terminal, observed, cursor);
  expect(terminal.resetAndWrite).toHaveBeenLastCalledWith("host output\nobserved output");

  const cleared = applyTerminalAttachStreamEvent(observed, {
    type: "cleared",
    threadId: "thread",
    terminalId: "term-1",
  });
  synchronizeTerminalOutput(terminal, cleared, observedCursor);
  expect(terminal.resetAndWrite).toHaveBeenLastCalledWith("");
});

describe("terminal ansi palette", () => {
  const base = Array.from({ length: 16 }, () => ({ r: 90, g: 90, b: 90 }));
  base[1] = { r: 205, g: 49, b: 49 };
  base[9] = { r: 241, g: 76, b: 76 };
  const noAccents = { red: null, green: null, yellow: null, blue: null, magenta: null };

  it("keeps the base palette when the theme provides no accents", () => {
    expect(deriveTerminalPalette(base, noAccents)).toEqual(base);
  });

  it("ignores gray accents so a gray theme does not wash out the ansi colors", () => {
    const palette = deriveTerminalPalette(base, { ...noAccents, red: { r: 128, g: 128, b: 128 } });
    expect(palette).toEqual(base);
  });

  it("takes the hue from the accent and keeps the base slot readable", () => {
    const palette = deriveTerminalPalette(base, { ...noAccents, red: { r: 80, g: 20, b: 230 } });
    const normal = palette[1]!;
    const bright = palette[9]!;
    expect(normal.b).toBeGreaterThan(normal.r);
    expect(normal.r).toBeGreaterThan(normal.g);
    expect(bright.b).toBeGreaterThan(bright.r);
    expect(Math.max(normal.r, normal.g, normal.b) / 255).toBeLessThan(0.95);
    expect(palette[2]).toEqual(base[2]);
  });

  it("derives cyan between the green and blue accents", () => {
    const palette = deriveTerminalPalette(base, {
      ...noAccents,
      green: { r: 16, g: 185, b: 129 },
      blue: { r: 59, g: 130, b: 246 },
    });
    const cyan = palette[6]!;
    expect(cyan.g).toBeGreaterThan(cyan.r);
    expect(cyan.b).toBeGreaterThan(cyan.r);
  });
});
