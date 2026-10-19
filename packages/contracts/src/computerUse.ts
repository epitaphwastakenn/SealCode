import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Claude's desktop app names its server this, so the tools read `mcp__computer-use__*` here too. */
export const COMPUTER_USE_MCP_SERVER_NAME = "computer-use";

/**
 * Browsers are read-only (their pages belong to the browser tools), terminals
 * and IDEs take plain left clicks only (shell work belongs to Bash), and
 * everything else is unrestricted.
 */
export const ComputerUseTier = Schema.Literals(["read", "click", "full"]);
export type ComputerUseTier = typeof ComputerUseTier.Type;

export const ComputerUseGrant = Schema.Struct({
  app: TrimmedNonEmptyString,
  tier: ComputerUseTier,
});
export type ComputerUseGrant = typeof ComputerUseGrant.Type;

/** Coordinates are in the pixel space of the latest screenshot. */
const Coordinate = Schema.Finite;

export const ComputerUseAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("request_access"),
    apps: Schema.Array(TrimmedNonEmptyString),
    reason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("list_granted_applications") }),
  Schema.Struct({ kind: Schema.Literal("screenshot") }),
  Schema.Struct({
    kind: Schema.Literal("click"),
    button: Schema.Literals(["left", "right", "middle"]),
    count: Schema.Literals([1, 2, 3]),
    x: Coordinate,
    y: Coordinate,
    /** Modifier keys held during the click, as in `key`: `"ctrl"`, `"shift+alt"`. */
    modifiers: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("mouse_move"), x: Coordinate, y: Coordinate }),
  Schema.Struct({
    kind: Schema.Literal("left_click_drag"),
    startX: Coordinate,
    startY: Coordinate,
    x: Coordinate,
    y: Coordinate,
  }),
  Schema.Struct({
    kind: Schema.Literal("scroll"),
    x: Coordinate,
    y: Coordinate,
    direction: Schema.Literals(["up", "down", "left", "right"]),
    amount: Schema.Int,
  }),
  Schema.Struct({ kind: Schema.Literal("type"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("key"),
    text: TrimmedNonEmptyString,
    repeat: Schema.optionalKey(Schema.Int),
  }),
  Schema.Struct({ kind: Schema.Literal("open_application"), name: TrimmedNonEmptyString }),
]);
export type ComputerUseAction = typeof ComputerUseAction.Type;
export type ComputerUseActionKind = ComputerUseAction["kind"];

export const ComputerUseScreenshot = Schema.Struct({
  /** Base64 image bytes. */
  data: Schema.String,
  mimeType: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
});
export type ComputerUseScreenshot = typeof ComputerUseScreenshot.Type;

export const ComputerUseActionResult = Schema.Struct({
  text: Schema.String,
  screenshot: Schema.optionalKey(ComputerUseScreenshot),
});
export type ComputerUseActionResult = typeof ComputerUseActionResult.Type;

/** Server to desktop, one JSON line per message on the computer-use control fd. */
export const ComputerUseCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("invoke"),
    requestId: TrimmedNonEmptyString,
    threadId: TrimmedNonEmptyString,
    /** Who the overlay and access dialog say is using the computer. */
    agentName: Schema.optionalKey(Schema.String),
    action: ComputerUseAction,
  }),
  /** The thread's turn ended: leave the overlay and restore the desktop. */
  Schema.Struct({
    type: Schema.Literal("end"),
    threadId: TrimmedNonEmptyString,
    restoreHiddenApps: Schema.Boolean,
  }),
]);
export type ComputerUseCommand = typeof ComputerUseCommand.Type;

/** Desktop to server, one JSON line per message on the computer-use fd. */
export const ComputerUseEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("result"),
    requestId: TrimmedNonEmptyString,
    ok: Schema.Literal(true),
    result: ComputerUseActionResult,
  }),
  Schema.Struct({
    type: Schema.Literal("result"),
    requestId: TrimmedNonEmptyString,
    ok: Schema.Literal(false),
    message: Schema.String,
  }),
  /** The user pressed Stop or Esc while the agent was driving the computer. */
  Schema.Struct({ type: Schema.Literal("stop"), threadId: TrimmedNonEmptyString }),
]);
export type ComputerUseEvent = typeof ComputerUseEvent.Type;
