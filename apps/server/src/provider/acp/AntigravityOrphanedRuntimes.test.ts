import { describe, expect, it } from "@effect/vitest";

import {
  parseWindowsProcessList,
  selectOrphanedRuntimeRoots,
  type WindowsProcessEntry,
} from "./AntigravityOrphanedRuntimes.ts";

const managed = "C:\\Users\\Dev\\.t3\\tools\\antigravity-acp";
const release = `${managed}\\win32-x64\\versions\\abc`;
const launcher = `${release}\\agy_acp_server.exe`;
const harness = `${release}\\localharness_external.exe`;

const entry = (
  pid: number,
  parentPid: number,
  createdAt: number,
  executablePath: string | null,
): WindowsProcessEntry => ({ pid, parentPid, createdAt, executablePath });

describe("selectOrphanedRuntimeRoots", () => {
  it("stops a tree whose server died and keeps the live server's runtime", () => {
    const processes = [
      entry(10, 1, 100, "C:\\Program Files\\Harp\\Harp.exe"),
      // The live server's runtime: launcher, agent server, harness.
      entry(20, 10, 200, launcher),
      entry(21, 20, 201, launcher),
      entry(22, 21, 202, harness),
      // A killed server (pid 5) left this tree behind.
      entry(30, 5, 150, launcher),
      entry(31, 30, 151, launcher),
      entry(32, 31, 152, harness),
    ];
    expect(selectOrphanedRuntimeRoots(processes, managed)).toEqual([30]);
  });

  it("stops the agent server when its launcher died first", () => {
    const processes = [entry(31, 30, 151, launcher), entry(32, 31, 152, harness)];
    expect(selectOrphanedRuntimeRoots(processes, managed)).toEqual([31]);
  });

  it("treats a parent pid reused after the runtime started as dead", () => {
    const processes = [entry(30, 7, 150, launcher), entry(7, 1, 900, "C:\\Windows\\notepad.exe")];
    expect(selectOrphanedRuntimeRoots(processes, managed)).toEqual([30]);
  });

  it("ignores processes outside the managed directory and matches paths case-insensitively", () => {
    const processes = [
      entry(40, 5, 150, "C:\\Users\\Dev\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe"),
      entry(41, 5, 150, "C:\\Users\\Dev\\.t3\\tools\\antigravity-acp-other\\agy_acp_server.exe"),
      entry(42, 5, 150, null),
      entry(43, 5, 150, launcher.toUpperCase()),
    ];
    expect(selectOrphanedRuntimeRoots(processes, `${managed}\\`)).toEqual([43]);
  });
});

describe("parseWindowsProcessList", () => {
  it("reads the PowerShell listing and skips noise", () => {
    expect(
      parseWindowsProcessList(
        `0|0|0|\r\n4|0|0|\r\n30|5|133000000000000000|${launcher}\r\nWARNING: x\r\n`,
      ),
    ).toEqual([entry(4, 0, 0, null), entry(30, 5, 133000000000000000, launcher)]);
  });
});
