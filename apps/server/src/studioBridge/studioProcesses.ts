// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off globalFetchInEffect:off -Studio is a native Windows process found and started with OS tools.
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

/**
 * Roblox Studio windows on this machine: listing, opening and closing them. Closing asks the
 * window to close, the way the user would, so Studio can still offer to save; forcing is an
 * explicit, separate choice.
 */

export interface StudioWindow {
  readonly pid: number;
  readonly title: string;
  /** The place name read off the title ("Place1 - Roblox Studio" -> "Place1"). */
  readonly place: string | undefined;
  readonly memoryKb: number;
}

const run = (command: string, args: ReadonlyArray<string>, timeoutMs = 15_000) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        NodeChildProcess.execFile(
          command,
          [...args],
          { windowsHide: true, timeout: timeoutMs, maxBuffer: 4_000_000 },
          (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
        );
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

const parseCsvLine = (line: string): ReadonlyArray<string> => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
};

export const placeFromTitle = (title: string): string | undefined => {
  const match = /^(.*?)\s+-\s+Roblox Studio/u.exec(title);
  const place = match?.[1]?.trim().split(/[\\/]/u).at(-1);
  return place === undefined || place === "" ? undefined : normalizePlaceName(place);
};

/** Window titles and plugin hellos name a place file with or without its extension. */
export const normalizePlaceName = (name: string): string => name.trim().replace(/\.rbxlx?$/iu, "");

export const listStudioWindows = Effect.gen(function* () {
  if (process.platform !== "win32") return [] as ReadonlyArray<StudioWindow>;
  const output = yield* run("tasklist", [
    "/FI",
    "IMAGENAME eq RobloxStudioBeta.exe",
    "/V",
    "/FO",
    "CSV",
    "/NH",
  ]);
  const windows: StudioWindow[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.startsWith('"')) continue;
    const cells = parseCsvLine(line);
    const pid = Number(cells[1]);
    if (!Number.isInteger(pid)) continue;
    const title = cells[8] ?? "";
    windows.push({
      pid,
      title: title === "N/A" ? "" : title,
      place: placeFromTitle(title),
      memoryKb: Number((cells[4] ?? "").replace(/[^\d]/gu, "")) || 0,
    });
  }
  return windows as ReadonlyArray<StudioWindow>;
});

/** The newest installed RobloxStudioBeta.exe. */
export const findStudioExecutable = Effect.sync(() => {
  const local = process.env.LOCALAPPDATA;
  if (process.platform !== "win32" || !local) return undefined;
  const versions = NodePath.join(local, "Roblox", "Versions");
  let best: { readonly path: string; readonly mtime: number } | undefined;
  try {
    for (const entry of NodeFs.readdirSync(versions)) {
      const candidate = NodePath.join(versions, entry, "RobloxStudioBeta.exe");
      try {
        const stat = NodeFs.statSync(candidate);
        if (best === undefined || stat.mtimeMs > best.mtime) {
          best = { path: candidate, mtime: stat.mtimeMs };
        }
      } catch {
        // Not a Studio version folder.
      }
    }
  } catch {
    return undefined;
  }
  return best?.path;
});

export const launchStudio = (input: {
  readonly executable: string;
  readonly placeFile?: string | undefined;
  readonly placeId?: number | undefined;
  readonly universeId?: number | undefined;
}) =>
  Effect.try({
    try: () => {
      const args =
        input.placeFile !== undefined
          ? [input.placeFile]
          : input.placeId !== undefined
            ? [
                "-task",
                "EditPlace",
                "-placeId",
                String(input.placeId),
                ...(input.universeId === undefined
                  ? []
                  : ["-universeId", String(input.universeId)]),
              ]
            : [];
      const child = NodeChildProcess.spawn(input.executable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return child.pid ?? 0;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** Asks the window to close (Studio may show its save prompt); `force` ends the process. */
export const closeStudio = (pid: number, force: boolean) =>
  run("taskkill", ["/PID", String(pid), ...(force ? ["/F"] : [])]).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
