import type { GlobalMcpServer, RobloxStudioSettings, ServerSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveNodeExecutable } from "@t3tools/shared/nodeRuntime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { unpackFiles } from "./roqerPack.ts";

export const ROQER_SERVER_ID = "robloxstudio";
export const OFFICIAL_SERVER_ID = "roblox-studio-official";
export const BLENDER_MCP_SERVER_ID = "blender";
export const MANAGED_SERVER_IDS: ReadonlySet<string> = new Set([
  ROQER_SERVER_ID,
  OFFICIAL_SERVER_ID,
  BLENDER_MCP_SERVER_ID,
]);

/** Roqer's bridge, plugin and agent bundle as `vendor/roqer-host/sync.ts` laid them out. */
export interface RoqerResources {
  readonly root: string;
  readonly hostEntry: string;
  readonly bridgeEntry: string;
  readonly pluginPath: string;
  readonly agentRoot: string;
  readonly version: string | undefined;
  readonly commit: string | undefined;
  readonly skills: number | undefined;
}

export interface RobloxStudioEnvironment {
  readonly roqer: RoqerResources | undefined;
  readonly roqerProblem: string | undefined;
  /** Runs the host: this server's own runtime unless it is a single executable. */
  readonly nodeCommand: string | undefined;
  readonly officialMcpPath: string | undefined;
  readonly studioInstalled: boolean;
  readonly blenderJobsRoot: string;
  /** Found in the usual install folders; a configured path wins over it. */
  readonly detectedBlender: string | undefined;
  /** The `mcp-for-blender` executable the official MCP for Blender installer makes, when present. */
  readonly detectedBlenderMcp: string | undefined;
}

export interface BlenderMcpLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const setting = (field: { readonly name: string; readonly value: string }, sensitive = false) => ({
  name: field.name,
  value: field.value,
  sensitive,
});

export const blenderExecutableFor = (
  roblox: RobloxStudioSettings,
  environment: Pick<RobloxStudioEnvironment, "detectedBlender">,
): string | undefined =>
  roblox.blenderExecutable.length > 0 ? roblox.blenderExecutable : environment.detectedBlender;

export const blenderMcpLaunchFor = (
  roblox: RobloxStudioSettings,
  environment: Pick<RobloxStudioEnvironment, "detectedBlenderMcp">,
): BlenderMcpLaunch => {
  if (roblox.blenderMcpCommand.length > 0) {
    return { command: roblox.blenderMcpCommand, args: roblox.blenderMcpArgs };
  }
  if (environment.detectedBlenderMcp !== undefined) {
    return { command: environment.detectedBlenderMcp, args: roblox.blenderMcpArgs };
  }
  return {
    command: "uvx",
    args: roblox.blenderMcpArgs.length > 0 ? roblox.blenderMcpArgs : ["blender-mcp"],
  };
};

/**
 * The MCP servers the Roblox settings stand for. They join the user's own servers in
 * `GlobalMcpManager`, so they share its connection, status, reconnect and gateway; a user server
 * with the same id wins.
 */
export const managedServersFor = (
  settings: Pick<ServerSettings, "robloxStudio">,
  environment: RobloxStudioEnvironment,
): Readonly<Record<string, GlobalMcpServer>> => {
  const roblox = settings.robloxStudio;
  if (roblox.mode === "off") return {};
  const servers: Record<string, GlobalMcpServer> = {};

  if (roblox.mode === "roqer" && environment.roqer !== undefined && environment.nodeCommand) {
    const roqer = environment.roqer;
    const blender = roblox.blenderWorker ? blenderExecutableFor(roblox, environment) : undefined;
    servers[ROQER_SERVER_ID] = {
      id: ROQER_SERVER_ID,
      displayName: "Roblox Studio (Roqer)",
      enabled: true,
      transport: "stdio",
      command: environment.nodeCommand,
      args: [
        roqer.hostEntry,
        "--bridge",
        roqer.bridgeEntry,
        "--plugin",
        roqer.pluginPath,
        "--agent",
        roqer.agentRoot,
        ...(blender === undefined
          ? []
          : ["--blender", blender, "--blender-jobs", environment.blenderJobsRoot]),
      ],
      // Saved values override what SealCode inherited, as Roqer passes them to its bridge;
      // with nothing saved, inherited values pass through.
      env: [
        setting({ name: "ELECTRON_RUN_AS_NODE", value: "1" }),
        ...(roblox.openCloudApiKey.length > 0
          ? [setting({ name: "ROBLOX_OPEN_CLOUD_API_KEY", value: roblox.openCloudApiKey }, true)]
          : []),
        ...(roblox.creatorUserId.length > 0
          ? [setting({ name: "ROBLOX_CREATOR_USER_ID", value: roblox.creatorUserId })]
          : []),
        ...(roblox.creatorGroupId.length > 0
          ? [setting({ name: "ROBLOX_CREATOR_GROUP_ID", value: roblox.creatorGroupId })]
          : []),
      ],
      headers: [],
    };
  }

  const official =
    roblox.mode === "official" || (roblox.mode === "roqer" && roblox.officialMcpAlongside);
  if (official && environment.officialMcpPath !== undefined) {
    servers[OFFICIAL_SERVER_ID] = {
      id: OFFICIAL_SERVER_ID,
      displayName: "Roblox Studio (official)",
      enabled: true,
      transport: "stdio",
      command: "cmd.exe",
      args: ["/c", environment.officialMcpPath],
      env: [],
      headers: [],
    };
  }

  if (roblox.blenderMcp) {
    const launch = blenderMcpLaunchFor(roblox, environment);
    servers[BLENDER_MCP_SERVER_ID] = {
      id: BLENDER_MCP_SERVER_ID,
      displayName: "Blender",
      enabled: true,
      transport: "stdio",
      command: launch.command,
      args: [...launch.args],
      env: [
        setting({ name: "BLENDER_MCP_DISABLE_TELEMETRY", value: "true" }),
        setting({ name: "DISABLE_TELEMETRY", value: "true" }),
      ],
      headers: [],
    };
  }
  return servers;
};

const ROBLOX_PROJECT_FILE =
  /^(?:.+\.project\.json|.+\.rbxlx?|.+\.rbxmx?|wally\.toml|aftman\.toml|rokit\.toml|foreman\.toml|selene\.toml|\.roqer)$/i;

/** A workspace whose root holds a Rojo project, a place or model file, Roblox tooling, or `.roqer`. */
export const isRobloxProjectListing = (entries: ReadonlyArray<string>): boolean =>
  entries.some((entry) => ROBLOX_PROJECT_FILE.test(entry));

const PROJECT_DETECTION_TTL_MS = 30_000;

export const autoPlaytestInstruction = (enabled: boolean): string =>
  enabled
    ? "Automatic playtesting is enabled. After a change that benefits from runtime verification, run the smallest useful playtest, inspect observable evidence, and stop it before replying."
    : "Automatic playtesting is disabled. Do not start a playtest merely for automatic verification; start one only when the user explicitly asks for testing or the request cannot be completed truthfully without runtime evidence.";

/** The run settings Roqer appends to its developer instructions, for this thread's workspace. */
export const runSettingsFor = (input: {
  readonly roblox: RobloxStudioSettings;
  readonly environment: Pick<RobloxStudioEnvironment, "detectedBlender" | "officialMcpPath">;
  readonly rojoProjects: ReadonlyArray<string>;
}): string => {
  const { roblox } = input;
  const lines = [autoPlaytestInstruction(roblox.autoPlaytest)];
  if (input.rojoProjects.length > 0) {
    lines.push(
      `This workspace has Rojo project files: ${input.rojoProjects.map((file) => `\`${file}\``).join(", ")}. When the user's place syncs from one, link it with manage_instance link_project before editing scripts.`,
    );
  }
  const blenderWorker =
    roblox.blenderWorker && blenderExecutableFor(roblox, input.environment) !== undefined;
  if (blenderWorker) {
    lines.push("Roqer's Blender worker is on: the `blender` tool runs headless Blender jobs.");
  }
  if (roblox.blenderMcp) {
    lines.push(
      "A Blender MCP server is connected (its tools are named like `mcp__blender__execute_blender_code`): it drives the user's live Blender. Model there, export a GLB or FBX into a folder, then upload it with upload_asset and insert it.",
    );
  }
  if (roblox.officialMcpAlongside && input.environment.officialMcpPath !== undefined) {
    lines.push(
      "Roblox's own Studio MCP is also connected (`roblox-studio-official`). Use it only for what Roqer's tools lack: generate_mesh, generate_texture, generate_material, generate_procedural_model, segment_mesh.",
    );
  }
  return `## This SealCode run\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
};

export interface RobloxStudioConfigShape {
  readonly environment: RobloxStudioEnvironment;
  readonly managedServers: (
    settings: Pick<ServerSettings, "robloxStudio">,
  ) => Readonly<Record<string, GlobalMcpServer>>;
  /** Whether a thread rooted at this workspace gets the Roblox tools and instructions. */
  readonly appliesTo: (
    settings: Pick<ServerSettings, "robloxStudio">,
    workspaceRoot: string | undefined,
  ) => Effect.Effect<boolean>;
  /**
   * Managed servers a thread rooted at this workspace must not see: outside Roblox projects
   * their tools would only cost every conversation tokens. A user server of the same id stays.
   */
  readonly hiddenServerIds: (
    settings: Pick<ServerSettings, "robloxStudio" | "mcpServers">,
    workspaceRoot: string | undefined,
  ) => Effect.Effect<ReadonlySet<string>>;
  /** Roqer's instructions for a turn in this workspace, or undefined when they do not apply. */
  readonly instructions: (
    settings: Pick<ServerSettings, "robloxStudio">,
    input: { readonly workspaceRoot: string | undefined; readonly cwd: string },
  ) => Effect.Effect<string | undefined>;
}

const disabledEnvironment: RobloxStudioEnvironment = {
  roqer: undefined,
  roqerProblem: undefined,
  nodeCommand: undefined,
  officialMcpPath: undefined,
  studioInstalled: false,
  blenderJobsRoot: "",
  detectedBlender: undefined,
  detectedBlenderMcp: undefined,
};

/**
 * A reference rather than a required service: a harness that never sets it up runs no Roblox
 * servers and adds no instructions, which is also what the settings' default (`off`) means.
 */
export const RobloxStudioConfig = Context.Reference<RobloxStudioConfigShape>(
  "t3/roblox/RobloxStudioConfig",
  {
    defaultValue: () => ({
      environment: disabledEnvironment,
      managedServers: () => ({}),
      appliesTo: () => Effect.succeed(false),
      hiddenServerIds: () => Effect.succeed(new Set<string>()),
      instructions: () => Effect.succeed(undefined),
    }),
  },
);

const RoqerManifest = Schema.Struct({
  version: Schema.optional(Schema.String),
  commit: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Number),
});
const decodeRoqerManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(RoqerManifest));

/**
 * The server build carries Roqer as `roqer.pack.gz` beside its chunks; it is unpacked once per
 * build into the state directory, and older unpacked builds are removed.
 */
const unpackBundledRoqer = Effect.fn("RobloxStudioConfig.unpackBundledRoqer")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packPath = path.resolve(import.meta.dirname, "roqer.pack.gz");
  if (!(yield* fs.exists(packPath).pipe(Effect.orElseSucceed(() => false)))) return undefined;
  const packed = yield* fs.readFile(packPath);
  const crypto = yield* Crypto.Crypto;
  const digest = Buffer.from(yield* crypto.digest("SHA-256", packed))
    .toString("hex")
    .slice(0, 16);
  const parent = path.join(stateDir, "roqer");
  const target = path.join(parent, `bundle-${digest}`);
  if (!(yield* fs.exists(path.join(target, "manifest.json")))) {
    const staging = `${target}.partial-${process.pid}`;
    yield* fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore);
    for (const file of unpackFiles(packed)) {
      const destination = path.join(staging, ...file.path.split("/"));
      yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
      yield* fs.writeFile(destination, file.data);
    }
    // Another server unpacking the same build may have won the race; its copy is identical.
    yield* fs
      .rename(staging, target)
      .pipe(Effect.catch(() => fs.remove(staging, { recursive: true, force: true })));
  }
  for (const entry of yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => []))) {
    if (entry.startsWith("bundle-") && entry !== `bundle-${digest}`) {
      yield* fs
        .remove(path.join(parent, entry), { recursive: true, force: true })
        .pipe(Effect.ignore);
    }
  }
  return target;
});

const resolveRoqerResources = Effect.fn("RobloxStudioConfig.resolveRoqerResources")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const bundled = yield* unpackBundledRoqer(stateDir).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("could not unpack the bundled Roqer", { cause }).pipe(Effect.as(undefined)),
    ),
  );
  const candidates = [
    environment.SEALCODE_ROQER_DIR,
    bundled,
    // Source checkout: apps/server/src/roblox.
    path.resolve(import.meta.dirname, "../../resources/roqer"),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  for (const root of candidates) {
    const hostEntry = path.join(root, "host", "main.mjs");
    if (!(yield* fs.exists(hostEntry).pipe(Effect.orElseSucceed(() => false)))) continue;
    const manifest = yield* fs.readFileString(path.join(root, "manifest.json")).pipe(
      Effect.flatMap(decodeRoqerManifest),
      Effect.orElseSucceed(() => ({}) as typeof RoqerManifest.Type),
    );
    return {
      root,
      hostEntry,
      bridgeEntry: path.join(root, "bridge", "dist", "index.mjs"),
      pluginPath: path.join(root, "plugin", "MCPPlugin.rbxmx"),
      agentRoot: path.join(root, "agent"),
      version: manifest.version,
      commit: manifest.commit,
      skills: manifest.skills,
    } satisfies RoqerResources;
  }
  return undefined;
});

/** Roqer's `detectBlender`, plus Steam libraries on other drives. */
export const detectBlender = Effect.fn("RobloxStudioConfig.detectBlender")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  const exists = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );
  if (platform === "darwin") {
    const app = "/Applications/Blender.app/Contents/MacOS/Blender";
    return (yield* exists(app)) ? app : undefined;
  }
  if (platform !== "win32") {
    for (const candidate of ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender"]) {
      if (yield* exists(candidate)) return candidate;
    }
    return undefined;
  }
  const candidates: string[] = [];
  const roots = [
    env.ProgramFiles && path.join(env.ProgramFiles, "Blender Foundation"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Blender Foundation"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Blender Foundation"),
  ].filter((root): root is string => typeof root === "string" && root !== "");
  for (const root of roots) {
    const versions = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
    for (const version of versions) candidates.push(path.join(root, version, "blender.exe"));
  }
  // Steam is often installed on another drive, where nothing in the environment points to it.
  const steamRoots = [
    ...[env["ProgramFiles(x86)"], env.ProgramFiles]
      .filter((root): root is string => typeof root === "string" && root !== "")
      .map((root) => path.join(root, "Steam")),
    ..."CDEFGH".split("").flatMap((drive) => [`${drive}:\\Steam`, `${drive}:\\SteamLibrary`]),
  ];
  const libraries = new Set(steamRoots);
  for (const steam of steamRoots) {
    const folders = yield* fs
      .readFileString(path.join(steam, "steamapps", "libraryfolders.vdf"))
      .pipe(Effect.orElseSucceed(() => ""));
    for (const match of folders.matchAll(/"path"\s+"([^"]+)"/g)) {
      if (match[1]) libraries.add(match[1].replaceAll("\\\\", "\\"));
    }
  }
  for (const library of libraries) {
    candidates.push(path.join(library, "steamapps", "common", "Blender", "blender.exe"));
  }
  const versionOf = (file: string) =>
    (path.basename(path.dirname(file)).match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  const found: string[] = [];
  for (const candidate of candidates) {
    if (yield* exists(candidate)) found.push(candidate);
  }
  found.sort((left, right) => {
    const [leftMajor = 0, leftMinor = 0] = versionOf(left);
    const [rightMajor = 0, rightMinor = 0] = versionOf(right);
    return rightMajor - leftMajor || rightMinor - leftMinor;
  });
  return found[0];
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;

  const roqer = yield* resolveRoqerResources(config.stateDir);
  const nodeCommand = yield* resolveNodeExecutable("Roblox Studio").pipe(
    Effect.map((command): string | undefined => command),
    Effect.orElseSucceed(() => undefined),
  );
  const localAppData = platform === "win32" ? env.LOCALAPPDATA?.trim() : undefined;
  const officialMcpPath =
    localAppData === undefined || localAppData === ""
      ? undefined
      : path.join(localAppData, "Roblox", "mcp.bat");
  const officialAvailable =
    officialMcpPath !== undefined &&
    (yield* fs.exists(officialMcpPath).pipe(Effect.orElseSucceed(() => false)));
  const studioInstalled =
    localAppData !== undefined &&
    localAppData !== "" &&
    (yield* fs
      .exists(path.join(localAppData, "Roblox", "Versions"))
      .pipe(Effect.orElseSucceed(() => false)));
  const blenderMcpCandidate = path.join(
    home,
    ".mcp-for-blender",
    platform === "win32" ? "Scripts" : "bin",
    platform === "win32" ? "mcp-for-blender.exe" : "mcp-for-blender",
  );
  const detectedBlenderMcp = (yield* fs
    .exists(blenderMcpCandidate)
    .pipe(Effect.orElseSucceed(() => false)))
    ? blenderMcpCandidate
    : undefined;

  const environment: RobloxStudioEnvironment = {
    roqer,
    roqerProblem:
      roqer === undefined
        ? "This SealCode build has no Roqer bundle (apps/server/resources/roqer)."
        : nodeCommand === undefined
          ? "Roqer needs Node.js: install it and make sure node is on PATH."
          : undefined,
    nodeCommand,
    officialMcpPath: officialAvailable ? officialMcpPath : undefined,
    studioInstalled,
    blenderJobsRoot: path.join(config.stateDir, "roqer", "blender-jobs"),
    detectedBlender: yield* detectBlender().pipe(Effect.orElseSucceed(() => undefined)),
    detectedBlenderMcp,
  };

  const detections = new Map<string, { readonly value: boolean; readonly at: number }>();
  const isRobloxProject = (root: string) =>
    Effect.gen(function* () {
      const cached = detections.get(root);
      const now = yield* Clock.currentTimeMillis;
      if (cached !== undefined && now - cached.at < PROJECT_DETECTION_TTL_MS) return cached.value;
      const entries = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
      const value = isRobloxProjectListing(entries);
      detections.set(root, { value, at: now });
      if (detections.size > 256) detections.delete(detections.keys().next().value ?? root);
      return value;
    });

  const appliesTo: RobloxStudioConfigShape["appliesTo"] = (settings, workspaceRoot) => {
    const roblox = settings.robloxStudio;
    if (roblox.mode === "off") return Effect.succeed(false);
    if (roblox.scope === "all-projects") return Effect.succeed(true);
    return workspaceRoot === undefined ? Effect.succeed(false) : isRobloxProject(workspaceRoot);
  };

  const hiddenServerIds: RobloxStudioConfigShape["hiddenServerIds"] = (settings, workspaceRoot) =>
    Effect.gen(function* () {
      const managed = Object.keys(managedServersFor(settings, environment)).filter(
        (id) => settings.mcpServers[id] === undefined,
      );
      if (managed.length === 0) return new Set<string>();
      return (yield* appliesTo(settings, workspaceRoot)) ? new Set<string>() : new Set(managed);
    });

  let instructionsTemplate: string | undefined;
  const loadInstructions = Effect.gen(function* () {
    if (instructionsTemplate !== undefined) return instructionsTemplate;
    if (roqer === undefined) return undefined;
    const text = yield* fs
      .readFileString(path.join(roqer.agentRoot, "sealcode-instructions.md"))
      .pipe(Effect.orElseSucceed(() => ""));
    if (text.trim() === "") return undefined;
    instructionsTemplate = text.trim();
    return instructionsTemplate;
  });

  const instructions: RobloxStudioConfigShape["instructions"] = (settings, input) =>
    Effect.gen(function* () {
      const roblox = settings.robloxStudio;
      if (roblox.mode !== "roqer" || !roblox.instructions) return undefined;
      if (!(yield* appliesTo(settings, input.workspaceRoot ?? input.cwd))) return undefined;
      const base = yield* loadInstructions;
      if (base === undefined) return undefined;
      const rojoProjects = (yield* fs.readDirectory(input.cwd).pipe(Effect.orElseSucceed(() => [])))
        .filter((entry) => entry.toLowerCase().endsWith(".project.json"))
        .sort()
        .map((entry) => path.join(input.cwd, entry));
      return `${base}\n\n${runSettingsFor({ roblox, environment, rojoProjects })}`;
    });

  return {
    environment,
    managedServers: (settings) => managedServersFor(settings, environment),
    appliesTo,
    hiddenServerIds,
    instructions,
  } satisfies RobloxStudioConfigShape;
});

export const layer = Layer.effect(RobloxStudioConfig, make);
