import type { ComputerUseAction, ComputerUseGrant, ComputerUseTier } from "@t3tools/contracts";

/** The process that owns a window, as the desktop reads it before each action. */
export interface ComputerUseAppIdentity {
  /** Executable file name, with or without `.exe`. */
  readonly exeName: string;
  readonly title?: string;
}

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.exe$/u, "")
    .replace(/[^a-z0-9]/gu, "");

/** Agents ask for apps by the name people use, which often is not the executable's. */
const EXECUTABLES_BY_APP_NAME: Readonly<Record<string, ReadonlyArray<string>>> = {
  paint: ["mspaint"],
  calculator: ["calculatorapp", "calc"],
  fileexplorer: ["explorer"],
  windowsexplorer: ["explorer"],
  googlechrome: ["chrome"],
  microsoftedge: ["msedge"],
  edge: ["msedge"],
  visualstudiocode: ["code"],
  vscode: ["code"],
  visualstudio: ["devenv"],
  terminal: ["windowsterminal", "wt"],
  windowsterminal: ["windowsterminal", "wt"],
  commandprompt: ["cmd"],
  windowspowershell: ["powershell"],
  word: ["winword"],
  microsoftword: ["winword"],
  excel: ["excel"],
  microsoftexcel: ["excel"],
  powerpoint: ["powerpnt"],
  microsoftpowerpoint: ["powerpnt"],
  outlook: ["outlook", "olk"],
  settings: ["systemsettings"],
  taskmanager: ["taskmgr"],
  mozillafirefox: ["firefox"],
  bravebrowser: ["brave"],
  sublimetext: ["sublimetext"],
  intellijidea: ["idea64", "idea"],
  pycharm: ["pycharm64", "pycharm"],
  webstorm: ["webstorm64", "webstorm"],
  rider: ["rider64", "rider"],
  androidstudio: ["studio64", "studio"],
};

const BROWSERS = new Set([
  "chrome",
  "chromium",
  "msedge",
  "firefox",
  "brave",
  "opera",
  "operagx",
  "vivaldi",
  "arc",
  "iexplore",
  "safari",
  "zen",
  "librewolf",
  "waterfox",
  "thorium",
  "yandex",
]);

const TERMINALS_AND_IDES = new Set([
  "windowsterminal",
  "wt",
  "cmd",
  "powershell",
  "pwsh",
  "conhost",
  "openconsole",
  "weztermgui",
  "wezterm",
  "alacritty",
  "mintty",
  "bash",
  "terminal",
  "iterm2",
  "warp",
  "ghostty",
  "kitty",
  "code",
  "codeinsiders",
  "cursor",
  "windsurf",
  "antigravity",
  "zed",
  "devenv",
  "sublimetext",
  "fleet",
  "xcode",
  "idea64",
  "idea",
  "pycharm64",
  "pycharm",
  "webstorm64",
  "webstorm",
  "rider64",
  "rider",
  "clion64",
  "goland64",
  "phpstorm64",
  "rubymine64",
  "datagrip64",
  "studio64",
  "studio",
]);

/** UWP apps draw their frame from this host, so its windows are told apart by title. */
const UWP_FRAME_HOST = "applicationframehost";

const executablesFor = (appName: string): ReadonlyArray<string> => {
  const key = normalize(appName);
  return EXECUTABLES_BY_APP_NAME[key] ?? [key];
};

export function computerUseTierForApp(appName: string): ComputerUseTier {
  const names = [normalize(appName), ...executablesFor(appName)];
  if (names.some((name) => BROWSERS.has(name))) return "read";
  if (names.some((name) => TERMINALS_AND_IDES.has(name))) return "click";
  return "full";
}

export function computerUseGrantMatches(
  grantedApp: string,
  identity: ComputerUseAppIdentity,
): boolean {
  const exe = normalize(identity.exeName);
  const wanted = normalize(grantedApp);
  if (wanted.length === 0) return false;
  if (exe === UWP_FRAME_HOST) {
    const title = normalize(identity.title ?? "");
    return title.length > 0 && (title === wanted || title.endsWith(wanted));
  }
  if (executablesFor(grantedApp).includes(exe)) return true;
  // Loose containment covers "Notepad++" -> notepadplusplus and similar, but
  // only for names long enough not to match by accident.
  return wanted.length >= 4 && exe.length >= 4 && (exe.includes(wanted) || wanted.includes(exe));
}

export function findComputerUseGrant(
  grants: ReadonlyArray<ComputerUseGrant>,
  identity: ComputerUseAppIdentity,
): ComputerUseGrant | undefined {
  return grants.find((grant) => computerUseGrantMatches(grant.app, identity));
}

/** What an action needs from the app it lands on; `undefined` means no app check. */
export function computerUseRequiredTier(action: ComputerUseAction): ComputerUseTier | undefined {
  switch (action.kind) {
    case "click":
      return action.button === "left" && (action.modifiers ?? "").trim() === "" ? "click" : "full";
    case "scroll":
      return "click";
    case "left_click_drag":
    case "type":
    case "key":
      return "full";
    case "request_access":
    case "list_granted_applications":
    case "screenshot":
    case "mouse_move":
    case "open_application":
      return undefined;
  }
}

const TIER_RANK: Readonly<Record<ComputerUseTier, number>> = { read: 0, click: 1, full: 2 };

const tierLimits: Readonly<Record<ComputerUseTier, string>> = {
  read: "it is visible in screenshots, but clicks, scrolling and typing are blocked. Use the browser tools to work with web pages",
  click:
    "it takes plain left clicks and scrolling only; typing, key presses, right clicks, modifier clicks and drags are blocked. Use Bash for shell work",
  full: "it has no restrictions",
};

export type ComputerUseAuthorization =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Decides whether `action` may land on the app that owns its target: the
 * window under the pointer for pointer actions, the foreground window for
 * keyboard actions.
 */
export function authorizeComputerUseAction(input: {
  readonly action: ComputerUseAction;
  readonly target: ComputerUseAppIdentity | undefined;
  readonly grants: ReadonlyArray<ComputerUseGrant>;
}): ComputerUseAuthorization {
  const required = computerUseRequiredTier(input.action);
  if (required === undefined) return { ok: true };
  if (input.target === undefined) {
    return {
      ok: false,
      message: "Could not tell which app this action would reach. Take a screenshot and retry.",
    };
  }
  const grant = findComputerUseGrant(input.grants, input.target);
  const appLabel = input.target.title?.trim() || input.target.exeName;
  if (grant === undefined) {
    return {
      ok: false,
      message: `"${appLabel}" (${input.target.exeName}) has not been granted. Call request_access with this app first.`,
    };
  }
  if (TIER_RANK[grant.tier] < TIER_RANK[required]) {
    return {
      ok: false,
      message: `"${grant.app}" was granted at tier "${grant.tier}": ${tierLimits[grant.tier]}.`,
    };
  }
  return { ok: true };
}
