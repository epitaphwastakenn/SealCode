/**
 * Agents name keys the xdotool way ("Return", "ctrl+s", "Page_Down"), and
 * often say "cmd" out of macOS habit; on Windows that means Ctrl.
 */
export interface WindowsKey {
  readonly vk: number;
  /** Needs KEYEVENTF_EXTENDEDKEY, or Windows reads it as the numpad twin. */
  readonly extended: boolean;
}

export type ParsedKey =
  | { readonly kind: "vk"; readonly key: WindowsKey }
  | { readonly kind: "unicode"; readonly text: string };

export interface ParsedChord {
  readonly modifiers: ReadonlyArray<WindowsKey>;
  readonly key: ParsedKey | undefined;
}

const vk = (code: number, extended = false): WindowsKey => ({ vk: code, extended });

export const VK_SHIFT = vk(0x10);
export const VK_CONTROL = vk(0x11);
export const VK_MENU = vk(0x12);
export const VK_LWIN = vk(0x5b, true);
export const VK_RETURN = vk(0x0d);
export const VK_TAB = vk(0x09);
export const VK_ESCAPE = vk(0x1b);

const MODIFIERS: Readonly<Record<string, WindowsKey>> = {
  ctrl: VK_CONTROL,
  control: VK_CONTROL,
  cmd: VK_CONTROL,
  command: VK_CONTROL,
  shift: VK_SHIFT,
  alt: VK_MENU,
  option: VK_MENU,
  super: VK_LWIN,
  win: VK_LWIN,
  windows: VK_LWIN,
  meta: VK_LWIN,
};

const NAMED_KEYS: Readonly<Record<string, WindowsKey>> = {
  return: VK_RETURN,
  enter: VK_RETURN,
  kpenter: VK_RETURN,
  tab: VK_TAB,
  escape: VK_ESCAPE,
  esc: VK_ESCAPE,
  backspace: vk(0x08),
  space: vk(0x20),
  pause: vk(0x13),
  capslock: vk(0x14),
  pageup: vk(0x21, true),
  prior: vk(0x21, true),
  pagedown: vk(0x22, true),
  next: vk(0x22, true),
  end: vk(0x23, true),
  home: vk(0x24, true),
  left: vk(0x25, true),
  up: vk(0x26, true),
  right: vk(0x27, true),
  down: vk(0x28, true),
  printscreen: vk(0x2c, true),
  print: vk(0x2c, true),
  insert: vk(0x2d, true),
  delete: vk(0x2e, true),
  del: vk(0x2e, true),
  menu: vk(0x5d, true),
  apps: vk(0x5d, true),
  numlock: vk(0x90, true),
  scrolllock: vk(0x91),
  volumemute: vk(0xad),
  volumedown: vk(0xae),
  volumeup: vk(0xaf),
  minus: vk(0xbd),
  plus: vk(0xbb),
  equal: vk(0xbb),
  comma: vk(0xbc),
  period: vk(0xbe),
  slash: vk(0xbf),
  semicolon: vk(0xba),
  grave: vk(0xc0),
  bracketleft: vk(0xdb),
  backslash: vk(0xdc),
  bracketright: vk(0xdd),
  apostrophe: vk(0xde),
};

const PUNCTUATION: Readonly<Record<string, WindowsKey>> = {
  ";": vk(0xba),
  "=": vk(0xbb),
  ",": vk(0xbc),
  "-": vk(0xbd),
  ".": vk(0xbe),
  "/": vk(0xbf),
  "`": vk(0xc0),
  "[": vk(0xdb),
  "\\": vk(0xdc),
  "]": vk(0xdd),
  "'": vk(0xde),
  " ": vk(0x20),
};

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/_(l|r)$/u, "")
    .replace(/[_\s-]/gu, "");

export function parseKeyName(name: string): ParsedKey | undefined {
  if (name.length === 1) {
    const code = name.toUpperCase().charCodeAt(0);
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a)) {
      return { kind: "vk", key: vk(code) };
    }
    const punctuation = PUNCTUATION[name];
    return punctuation ? { kind: "vk", key: punctuation } : { kind: "unicode", text: name };
  }
  const normalized = normalizeName(name);
  const named = NAMED_KEYS[normalized];
  if (named) return { kind: "vk", key: named };
  const fn = /^f(\d{1,2})$/u.exec(normalized);
  if (fn) {
    const index = Number(fn[1]);
    if (index >= 1 && index <= 24) return { kind: "vk", key: vk(0x6f + index) };
  }
  const numpad = /^(?:kp|numpad)(\d)$/u.exec(normalized);
  if (numpad) return { kind: "vk", key: vk(0x60 + Number(numpad[1])) };
  return undefined;
}

/** `"ctrl+shift+s"`, `"Return"`, `"ctrl++"`; returns a message for names it cannot press. */
export function parseChord(text: string): ParsedChord | string {
  const trimmed = text.trim();
  // A trailing "+" after a separator is the plus key itself.
  const parts = trimmed.endsWith("++")
    ? [...trimmed.slice(0, -2).split("+"), "+"]
    : trimmed === "+"
      ? ["+"]
      : trimmed.split("+");
  const modifiers: WindowsKey[] = [];
  let key: ParsedKey | undefined;
  for (const [index, rawPart] of parts.entries()) {
    const part = rawPart.trim();
    if (part.length === 0) return `Could not read the key chord "${text}".`;
    const modifier = MODIFIERS[normalizeName(part)];
    if (modifier && index < parts.length - 1) {
      modifiers.push(modifier);
      continue;
    }
    if (modifier && parts.length === 1) {
      return { modifiers: [modifier], key: undefined };
    }
    if (index !== parts.length - 1) return `"${part}" is not a modifier key.`;
    const parsed = part === "+" ? { kind: "unicode" as const, text: "+" } : parseKeyName(part);
    if (parsed === undefined) return `Unknown key "${part}".`;
    key = parsed;
  }
  return { modifiers, key };
}

/** Parses click modifiers such as `"ctrl"` or `"shift+alt"`. */
export function parseModifiers(text: string | undefined): ReadonlyArray<WindowsKey> | string {
  if (text === undefined || text.trim() === "") return [];
  const keys: WindowsKey[] = [];
  for (const part of text.split("+")) {
    const modifier = MODIFIERS[normalizeName(part.trim())];
    if (modifier === undefined) return `"${part.trim()}" is not a modifier key.`;
    keys.push(modifier);
  }
  return keys;
}
