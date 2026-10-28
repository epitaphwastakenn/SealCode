/**
 * Readable timeline titles for Harp's Roblox Studio tools (MCP server `studio`), so a thread
 * shows "Read script Greeter" instead of `mcp__studio__get_script_source`.
 */

export const STUDIO_MCP_SERVER = "studio";
export const STUDIO_TOOL_SOURCE_NAME = "Roblox Studio";

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** The last segment of an instance path: `game.Workspace["My Part"]` -> `My Part`. */
const leaf = (path: unknown): string | undefined => {
  const value = text(path);
  if (value === undefined) return undefined;
  const bracket = /\["((?:[^"\\]|\\.)*)"\]$/u.exec(value);
  if (bracket?.[1] !== undefined) return bracket[1].replaceAll('\\"', '"');
  const dotted = value.split(".").at(-1);
  return dotted === undefined || dotted === "game" ? value : dotted;
};

/** The last segment of a file path, either separator. */
const fileName = (path: unknown): string | undefined => text(path)?.split(/[\\/]/u).at(-1);

const firstLine = (code: unknown): string | undefined => {
  const line = text(code)?.split("\n")[0]?.trim();
  return line === undefined ? undefined : line.length > 60 ? `${line.slice(0, 57)}…` : line;
};

const count = (value: unknown, noun: string): string | undefined =>
  Array.isArray(value)
    ? `${String(value.length)} ${noun}${value.length === 1 ? "" : "s"}`
    : undefined;

type Detail = (args: Record<string, unknown>) => string | undefined;

const target = (args: Record<string, unknown>) => leaf(args.path) ?? text(args.instanceRef);

const STUDIO_TOOLS: Readonly<Record<string, readonly [title: string, detail?: Detail]>> = {
  get_bridge_status: ["Check the Studio connection"],
  get_connected_instances: ["List connected places"],
  get_place_info: ["Read place info"],
  get_project_structure: ["Browse", (args) => leaf(args.path) ?? "the game tree"],
  search_objects: ["Search", (args) => text(args.query)],
  get_instance_properties: ["Read properties of", target],
  set_properties: ["Set properties on", target],
  create_instances: ["Create", (args) => count(args.instances, "instance")],
  delete_instances: ["Delete", (args) => count(args.paths, "instance")],
  build_instances: ["Build", (args) => leaf(args.path)],
  get_script_source: ["Read script", target],
  set_script_source: ["Write script", target],
  edit_script: ["Edit script", target],
  grep_scripts: ["Search scripts for", (args) => text(args.pattern)],
  selection: ["Studio selection", (args) => text(args.action)],
  execute_luau: ["Run Luau", (args) => firstLine(args.code)],
  eval_server_runtime: ["Run Luau in the play server", (args) => firstLine(args.code)],
  eval_client_runtime: ["Run Luau in", (args) => text(args.target) ?? "client-1"],
  playtest: [
    "Playtest",
    (args) => [text(args.action), text(args.mode)].filter(Boolean).join(" ") || undefined,
  ],
  multiplayer_playtest: ["Multiplayer test", (args) => text(args.action)],
  get_output_logs: ["Read output", (args) => text(args.target)],
  capture_screenshot: ["Screenshot", (args) => text(args.target)],
  inspect_ui: ["Inspect UI", (args) => (text(args.mode) === "audit" ? "audit" : undefined)],
  interact_ui: ["Use UI", (args) => text(args.action)],
  simulate_mouse_input: ["Mouse", (args) => text(args.action)],
  simulate_keyboard_input: [
    "Keyboard",
    (args) => text(args.keyCode) ?? (text(args.text) === undefined ? undefined : "type text"),
  ],
  get_device_simulator_state: ["Read device simulator"],
  set_device_simulator: [
    "Simulate",
    (args) => text(args.deviceId) ?? (args.stopSimulation === true ? "no device" : undefined),
  ],
  capture_device_matrix: ["Device matrix", (args) => count(args.entries, "device")],
  load_skill: ["Load skill", (args) => text(args.name)],
  camera: [
    "Camera",
    (args) =>
      [text(args.action), text(args.angle), args.screenshot === true ? "+ screenshot" : undefined]
        .filter(Boolean)
        .join(" ") || undefined,
  ],
  search_assets: ["Search the Creator Store for", (args) => text(args.query)],
  get_asset_details: [
    "Check asset",
    (args) => (typeof args.assetId === "number" ? String(args.assetId) : undefined),
  ],
  insert_asset: [
    "Insert asset",
    (args) =>
      text(args.name) ?? (typeof args.assetId === "number" ? String(args.assetId) : undefined),
  ],
  manage_studio: ["Studio windows", (args) => text(args.action)],
  blender: ["Blender job"],
  import_mesh: ["Import mesh", (args) => text(args.name)],
  animation: [
    "Animation",
    (args) =>
      [text(args.action), leaf(args.rig) ?? leaf(args.sequence) ?? text(args.animationId)]
        .filter(Boolean)
        .join(" ") || undefined,
  ],
  capture_script_profiler: ["Profile scripts", (args) => text(args.target) ?? "server"],
  get_memory_breakdown: ["Memory breakdown", (args) => text(args.target)],
  get_scene_analysis: ["Analyse the scene", (args) => leaf(args.path)],
  export_rbxm: ["Export model to", (args) => fileName(args.outputPath)],
  import_rbxm: ["Import model", (args) => fileName(args.filePath)],
  set_network_profile: ["Simulate network", (args) => text(args.profile)],
  breakpoints: [
    "Logpoint",
    (args) =>
      [
        text(args.action),
        leaf(args.script),
        typeof args.line === "number" ? `line ${String(args.line)}` : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  ],
  get_roblox_docs: [
    "Look up Roblox docs for",
    (args) => [text(args.name), text(args.member)].filter(Boolean).join(".") || undefined,
  ],
};

export const isStudioTool = (tool: string | undefined): boolean =>
  tool !== undefined && Object.hasOwn(STUDIO_TOOLS, tool);

export const studioToolTitle = (tool: string, args?: unknown): string | undefined => {
  const entry = STUDIO_TOOLS[tool];
  if (entry === undefined) return undefined;
  const [title, detail] = entry;
  const extra = detail?.(record(args) ?? {});
  return extra === undefined ? title : `${title} ${extra}`;
};
