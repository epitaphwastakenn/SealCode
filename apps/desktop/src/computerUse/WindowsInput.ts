/**
 * Input goes through user32 `SendInput` via ffi-rs, which the desktop already
 * ships for its foreground-window work: no extra native module to rebuild for
 * Electron, and `KEYEVENTF_UNICODE` types any text regardless of keyboard
 * layout. The cursor is placed with `SetCursorPos`, in physical pixels.
 */
import { VK_RETURN, VK_TAB, type ParsedChord, type WindowsKey } from "./keys.ts";

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
/** sizeof(INPUT) on x64: a DWORD type, padding, then the 32-byte union. */
const INPUT_SIZE = 40;

const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x1000;
const WHEEL_DELTA = 120;

export type MouseButton = "left" | "right" | "middle";

export type InputEvent =
  | { readonly type: "key"; readonly vk: number; readonly scan: number; readonly flags: number }
  | { readonly type: "mouse"; readonly flags: number; readonly data: number };

const BUTTON_FLAGS: Readonly<Record<MouseButton, readonly [number, number]>> = {
  left: [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP],
  right: [MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP],
  middle: [MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP],
};

const keyEvent = (key: WindowsKey, up: boolean): InputEvent => ({
  type: "key",
  vk: key.vk,
  scan: 0,
  flags: (key.extended ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0),
});

const unicodeEvents = (codeUnit: number): InputEvent[] => [
  { type: "key", vk: 0, scan: codeUnit, flags: KEYEVENTF_UNICODE },
  { type: "key", vk: 0, scan: codeUnit, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
];

const press = (key: WindowsKey): InputEvent[] => [keyEvent(key, false), keyEvent(key, true)];

export function encodeInputs(events: ReadonlyArray<InputEvent>): Buffer {
  const buffer = Buffer.alloc(events.length * INPUT_SIZE);
  events.forEach((event, index) => {
    const base = index * INPUT_SIZE;
    if (event.type === "key") {
      buffer.writeUInt32LE(INPUT_KEYBOARD, base);
      buffer.writeUInt16LE(event.vk, base + 8);
      buffer.writeUInt16LE(event.scan, base + 10);
      buffer.writeUInt32LE(event.flags, base + 12);
    } else {
      buffer.writeUInt32LE(INPUT_MOUSE, base);
      buffer.writeInt32LE(event.data, base + 16);
      buffer.writeUInt32LE(event.flags, base + 20);
    }
  });
  return buffer;
}

/** Newlines and tabs go as real keys so editors treat them as Enter and Tab. */
export function typeTextEvents(text: string): InputEvent[] {
  const events: InputEvent[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "\r") continue;
    if (char === "\n") events.push(...press(VK_RETURN));
    else if (char === "\t") events.push(...press(VK_TAB));
    else events.push(...unicodeEvents(text.charCodeAt(index)));
  }
  return events;
}

export function chordEvents(chord: ParsedChord): InputEvent[] {
  const down = chord.modifiers.map((key) => keyEvent(key, false));
  const up = chord.modifiers.toReversed().map((key) => keyEvent(key, true));
  const main =
    chord.key === undefined
      ? []
      : chord.key.kind === "vk"
        ? press(chord.key.key)
        : typeTextEvents(chord.key.text);
  return [...down, ...main, ...up];
}

export function clickEvents(
  button: MouseButton,
  count: number,
  modifiers: ReadonlyArray<WindowsKey>,
): InputEvent[] {
  const [downFlag, upFlag] = BUTTON_FLAGS[button];
  const clicks = Array.from({ length: count }, () => [
    { type: "mouse" as const, flags: downFlag, data: 0 },
    { type: "mouse" as const, flags: upFlag, data: 0 },
  ]).flat();
  return [
    ...modifiers.map((key) => keyEvent(key, false)),
    ...clicks,
    ...modifiers.toReversed().map((key) => keyEvent(key, true)),
  ];
}

export function buttonEvent(button: MouseButton, up: boolean): InputEvent {
  return { type: "mouse", flags: BUTTON_FLAGS[button][up ? 1 : 0], data: 0 };
}

export function scrollEvents(direction: "up" | "down" | "left" | "right", amount: number) {
  const vertical = direction === "up" || direction === "down";
  // Positive wheel data scrolls up, and positive horizontal data scrolls right.
  const sign = direction === "up" || direction === "right" ? 1 : -1;
  return Array.from({ length: amount }, () => ({
    type: "mouse" as const,
    flags: vertical ? MOUSEEVENTF_WHEEL : MOUSEEVENTF_HWHEEL,
    data: sign * WHEEL_DELTA,
  }));
}

export interface WindowsInputApi {
  readonly send: (events: ReadonlyArray<InputEvent>) => void;
  readonly setCursorPos: (x: number, y: number) => void;
}

let inputApiPromise: Promise<WindowsInputApi> | undefined;

export function loadWindowsInputApi(): Promise<WindowsInputApi> {
  inputApiPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const user32 = "t3-computer-use-user32";
    open({ library: user32, path: "user32.dll" });
    return {
      send: (events) => {
        if (events.length === 0) return;
        const buffer = encodeInputs(events);
        const sent = load({
          library: user32,
          funcName: "SendInput",
          retType: DataType.U32,
          paramsType: [DataType.U32, DataType.U8Array, DataType.I32],
          paramsValue: [events.length, buffer, INPUT_SIZE],
        });
        // Windows drops input aimed at a higher-integrity window (UIPI), e.g. an elevated app.
        if (sent !== events.length) {
          throw new Error(
            "Windows blocked the input. The target app may be running as administrator.",
          );
        }
      },
      setCursorPos: (x, y) => {
        load({
          library: user32,
          funcName: "SetCursorPos",
          retType: DataType.Boolean,
          paramsType: [DataType.I32, DataType.I32],
          paramsValue: [Math.round(x), Math.round(y)],
        });
      },
    };
  });
  return inputApiPromise;
}
