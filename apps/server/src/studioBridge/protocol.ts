/**
 * The wire contract between SealCode's Studio bridge and its Roblox Studio plugin. The plugin's
 * `Config` module is generated from these values at install time, so both sides read one source.
 *
 * The downstream is a long-poll, not a Server-Sent-Events stream: Studio's SSE client hands the
 * plugin whatever one socket read returned, which forces framing and chunking code on both
 * sides, while a long-poll answer is one complete HTTP body of any size and a failed poll is
 * itself the disconnect signal.
 */

/** Bumped only for wire-incompatible changes; a cosmetic plugin fix keeps it. */
export const STUDIO_PROTOCOL_VERSION = 1;

/** Avoids Roqer's 58741 so both bridges can run side by side. */
export const DEFAULT_STUDIO_BRIDGE_PORT = 58760;

export const PLUGIN_KEY_HEADER = "x-sealcode-studio-key";

export const StudioRoutes = {
  hello: "/studio/v1/hello",
  poll: "/studio/v1/poll",
  response: "/studio/v1/response",
  events: "/studio/v1/events",
  bye: "/studio/v1/bye",
  mcp: "/mcp",
} as const;

export const StudioLimits = {
  /** A poll waits at most this long for work; HttpService requests time out a little past 30 s. */
  pollWaitSeconds: 20,
  /** A peer without a poll for this long is gone. */
  staleAfterMs: 45_000,
  /** A silent holder of the same (place, role) is replaced after this long. */
  duplicateTakeoverMs: 3_000,
  aliasTtlMs: 5 * 60_000,
  defaultRequestTimeoutMs: 30_000,
  maxRequestTimeoutMs: 300_000,
  tombstoneTtlMs: 60_000,
  maxTombstones: 4096,
  maxRequestsPerPoll: 16,
  maxBodyBytes: 64 * 1024 * 1024,
  maxEventsPerBatch: 64,
  maxEventBatchBytes: 64 * 1024,
  /** Text one tool result may hand the model. */
  maxResultChars: 24_000,
} as const;

export type StudioRole = "edit" | "server" | `client-${number}`;

export const isStudioRole = (value: unknown): value is StudioRole =>
  value === "edit" ||
  value === "server" ||
  (typeof value === "string" && /^client-\d+$/.test(value));

/** Capabilities the plugin reports in `hello` after probing Studio's APIs. */
export const KNOWN_CAPABILITIES = [
  "scriptEditor",
  "loadstring",
  "capture",
  "editableImage",
  "studioTest",
  "reflection",
  "events",
] as const;
export type StudioCapability = (typeof KNOWN_CAPABILITIES)[number];

/** Events the plugin may send on its own; anything else is dropped. Their text is user data. */
export const STUDIO_EVENT_TYPES = [
  "selection_changed",
  "log_error",
  "toggles_changed",
  "playtest_changed",
  "peer_note",
] as const;
export type StudioEventType = (typeof STUDIO_EVENT_TYPES)[number];

/** Plugin endpoints the tools call. */
export const StudioEndpoints = {
  placeInfo: "place-info",
  projectStructure: "project-structure",
  searchObjects: "search-objects",
  getProperties: "get-properties",
  setProperties: "set-properties",
  createInstances: "create-instances",
  deleteInstances: "delete-instances",
  getScriptSource: "get-script-source",
  setScriptSource: "set-script-source",
  editScript: "edit-script",
  grepScripts: "grep-scripts",
  selection: "selection",
  executeLuau: "execute-luau",
  startPlaytest: "start-playtest",
  stopPlaytest: "stop-playtest",
  endTest: "end-test",
  playtestState: "playtest-state",
  getLogs: "get-logs",
  captureScreenshot: "capture-screenshot",
} as const;
export type StudioEndpoint = (typeof StudioEndpoints)[keyof typeof StudioEndpoints];

/** Endpoints that change the place; the plugin's read-only toggle refuses them. */
export const MUTATING_ENDPOINTS: ReadonlySet<string> = new Set([
  StudioEndpoints.setProperties,
  StudioEndpoints.createInstances,
  StudioEndpoints.deleteInstances,
  StudioEndpoints.setScriptSource,
  StudioEndpoints.editScript,
  StudioEndpoints.executeLuau,
  StudioEndpoints.startPlaytest,
  StudioEndpoints.stopPlaytest,
  StudioEndpoints.endTest,
]);
