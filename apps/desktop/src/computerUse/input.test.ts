import { describe, expect, it } from "vite-plus/test";

import { imageToPhysical, screenGeometry, screenshotSize } from "./geometry.ts";
import { parseChord, parseModifiers, VK_CONTROL, VK_LWIN, VK_RETURN, VK_SHIFT } from "./keys.ts";
import { chordEvents, encodeInputs, scrollEvents, typeTextEvents } from "./WindowsInput.ts";

describe("parseChord", () => {
  it("reads xdotool-style chords and maps cmd to Ctrl", () => {
    expect(parseChord("Return")).toEqual({ modifiers: [], key: { kind: "vk", key: VK_RETURN } });
    expect(parseChord("cmd+s")).toEqual({
      modifiers: [VK_CONTROL],
      key: { kind: "vk", key: { vk: 0x53, extended: false } },
    });
    expect(parseChord("ctrl+shift+Page_Down")).toEqual({
      modifiers: [VK_CONTROL, VK_SHIFT],
      key: { kind: "vk", key: { vk: 0x22, extended: true } },
    });
    expect(parseChord("super")).toEqual({ modifiers: [VK_LWIN], key: undefined });
    expect(parseChord("F5")).toMatchObject({ key: { kind: "vk", key: { vk: 0x74 } } });
    expect(parseChord("ctrl++")).toMatchObject({ key: { kind: "unicode", text: "+" } });
  });

  it("explains names it cannot press", () => {
    expect(parseChord("ctrl+banana")).toBe('Unknown key "banana".');
    expect(parseChord("a+b")).toBe('"a" is not a modifier key.');
    expect(parseModifiers("ctrl+x")).toBe('"x" is not a modifier key.');
  });
});

describe("SendInput encoding", () => {
  it("lays out keyboard and mouse INPUT records as x64 Windows expects", () => {
    const buffer = encodeInputs([
      ...chordEvents({ modifiers: [], key: { kind: "vk", key: VK_RETURN } }),
      ...scrollEvents("down", 1),
    ]);
    expect(buffer.byteLength).toBe(3 * 40);
    expect(buffer.readUInt32LE(0)).toBe(1);
    expect(buffer.readUInt16LE(8)).toBe(0x0d);
    expect(buffer.readUInt32LE(40 + 12)).toBe(0x0002);
    expect(buffer.readUInt32LE(80)).toBe(0);
    expect(buffer.readInt32LE(80 + 16)).toBe(-120);
    expect(buffer.readUInt32LE(80 + 20)).toBe(0x0800);
  });

  it("types Unicode text code unit by code unit, with real Enter for newlines", () => {
    const events = typeTextEvents("Oi ç\n😀");
    const scans = events.flatMap((event) =>
      event.type === "key" && (event.flags & 0x0002) === 0 ? [event.scan || event.vk] : [],
    );
    expect(scans).toEqual([0x4f, 0x69, 0x20, 0xe7, 0x0d, 0xd83d, 0xde00]);
  });
});

describe("screenshot geometry", () => {
  it("scales a 4K display down and maps image pixels back to physical pixels", () => {
    expect(screenshotSize(3840, 2160)).toEqual({ width: 1430, height: 804 });
    const geometry = screenGeometry({ x: 0, y: 0, width: 3840, height: 2160 });
    expect(imageToPhysical(geometry, 0, 0)).toEqual({ x: 1, y: 1 });
    expect(imageToPhysical(geometry, geometry.imageWidth - 1, geometry.imageHeight - 1)).toEqual({
      x: 3839,
      y: 2159,
    });
  });

  it("keeps a secondary display's offset", () => {
    const geometry = screenGeometry({ x: -1920, y: 0, width: 1920, height: 1080 });
    expect(geometry.imageWidth).toBe(1430);
    expect(imageToPhysical(geometry, 715, 402).x).toBeLessThan(0);
  });
});
