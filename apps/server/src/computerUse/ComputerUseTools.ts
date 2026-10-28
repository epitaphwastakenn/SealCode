/**
 * The tool surface mirrors Claude's desktop computer-use server (names,
 * `coordinate` pairs, `text` for modifiers) so agents trained on it need no
 * new habits here.
 */
import type { ComputerUseAction, ComputerUseActionResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ComputerUseChannel } from "./ComputerUseChannel.ts";

const coordinate = (description: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
  description,
});

const POINT = coordinate("[x, y] in pixels of the latest screenshot.");
const MODIFIERS = {
  type: "string",
  description:
    'Modifier keys to hold during the click, joined with "+", e.g. "ctrl" or "shift+alt".',
};

const objectSchema = (properties: Record<string, unknown>, required: ReadonlyArray<string>) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

interface ComputerUseToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly readOnly: boolean;
}

export const COMPUTER_USE_TOOLS: ReadonlyArray<ComputerUseToolDefinition> = [
  {
    name: "request_access",
    description:
      "Ask the user for access to desktop applications before acting on them. Call it again when a task needs another app. Browsers are granted read-only, terminals and IDEs click-only, everything else in full.",
    inputSchema: objectSchema(
      {
        apps: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: 'Application names as people know them, e.g. ["Paint", "Notepad"].',
        },
        reason: { type: "string", description: "One sentence the user sees in the dialog." },
      },
      ["apps"],
    ),
    readOnly: false,
  },
  {
    name: "list_granted_applications",
    description: "List the applications granted in this session and their tiers.",
    inputSchema: objectSchema({}, []),
    readOnly: true,
  },
  {
    name: "screenshot",
    description:
      "Capture the screen. Coordinates for every other tool are pixels in this image. Harp's own windows never appear in it.",
    inputSchema: objectSchema({}, []),
    readOnly: true,
  },
  ...(
    [
      ["left_click", "Left-click at a point."],
      ["right_click", "Right-click at a point. Needs a full-tier app."],
      ["double_click", "Double-click at a point."],
      ["triple_click", "Triple-click at a point, e.g. to select a line."],
    ] as const
  ).map(([name, description]) => ({
    name,
    description,
    inputSchema: objectSchema({ coordinate: POINT, text: MODIFIERS }, ["coordinate"]),
    readOnly: false,
  })),
  {
    name: "mouse_move",
    description: "Move the pointer without clicking, e.g. to reveal a tooltip.",
    inputSchema: objectSchema({ coordinate: POINT }, ["coordinate"]),
    readOnly: false,
  },
  {
    name: "left_click_drag",
    description: "Press the left button at start_coordinate, drag to coordinate and release.",
    inputSchema: objectSchema(
      { start_coordinate: coordinate("Where the drag starts."), coordinate: POINT },
      ["start_coordinate", "coordinate"],
    ),
    readOnly: false,
  },
  {
    name: "scroll",
    description: "Scroll at a point.",
    inputSchema: objectSchema(
      {
        coordinate: POINT,
        scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
        scroll_amount: { type: "integer", minimum: 1, maximum: 50, description: "Wheel notches." },
      },
      ["coordinate", "scroll_direction"],
    ),
    readOnly: false,
  },
  {
    name: "type",
    description: "Type text into the focused app. Any Unicode text works.",
    inputSchema: objectSchema({ text: { type: "string" } }, ["text"]),
    readOnly: false,
  },
  {
    name: "key",
    description:
      'Press a key or chord, e.g. "Return", "Escape", "ctrl+s", "alt+F4". "cmd" means Ctrl on Windows.',
    inputSchema: objectSchema(
      {
        text: { type: "string" },
        repeat: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["text"],
    ),
    readOnly: false,
  },
  {
    name: "open_application",
    description:
      "Open an application, or bring it to the front if it is already running. It must have been granted first.",
    inputSchema: objectSchema({ app: { type: "string" } }, ["app"]),
    readOnly: false,
  },
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const point = (value: unknown, field: string): readonly [number, number] | string => {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    return [value[0] as number, value[1] as number];
  }
  return `${field} must be an [x, y] pair of numbers.`;
};

const nonEmpty = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const CLICKS = {
  left_click: { button: "left", count: 1 },
  right_click: { button: "right", count: 1 },
  double_click: { button: "left", count: 2 },
  triple_click: { button: "left", count: 3 },
} as const;

/** Returns the action, or a message telling the agent what was wrong with its arguments. */
export function computerUseActionFromToolCall(
  name: string,
  rawArguments: unknown,
): ComputerUseAction | string {
  const args = asRecord(rawArguments);
  switch (name) {
    case "request_access": {
      const apps = Array.isArray(args.apps)
        ? args.apps.flatMap((app) => {
            const trimmed = nonEmpty(app);
            return trimmed === undefined ? [] : [trimmed];
          })
        : [];
      if (apps.length === 0) return "apps must list at least one application name.";
      const reason = nonEmpty(args.reason);
      return { kind: "request_access", apps, ...(reason === undefined ? {} : { reason }) };
    }
    case "list_granted_applications":
      return { kind: "list_granted_applications" };
    case "screenshot":
      return { kind: "screenshot" };
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click": {
      const at = point(args.coordinate, "coordinate");
      if (typeof at === "string") return at;
      const modifiers = nonEmpty(args.text);
      return {
        kind: "click",
        ...CLICKS[name],
        x: at[0],
        y: at[1],
        ...(modifiers === undefined ? {} : { modifiers }),
      };
    }
    case "mouse_move": {
      const at = point(args.coordinate, "coordinate");
      return typeof at === "string" ? at : { kind: "mouse_move", x: at[0], y: at[1] };
    }
    case "left_click_drag": {
      const from = point(args.start_coordinate, "start_coordinate");
      if (typeof from === "string") return from;
      const to = point(args.coordinate, "coordinate");
      if (typeof to === "string") return to;
      return { kind: "left_click_drag", startX: from[0], startY: from[1], x: to[0], y: to[1] };
    }
    case "scroll": {
      const at = point(args.coordinate, "coordinate");
      if (typeof at === "string") return at;
      const direction = args.scroll_direction;
      if (
        direction !== "up" &&
        direction !== "down" &&
        direction !== "left" &&
        direction !== "right"
      ) {
        return "scroll_direction must be up, down, left or right.";
      }
      const amount =
        typeof args.scroll_amount === "number" && Number.isInteger(args.scroll_amount)
          ? Math.min(50, Math.max(1, args.scroll_amount))
          : 3;
      return { kind: "scroll", x: at[0], y: at[1], direction, amount };
    }
    case "type":
      return typeof args.text === "string" && args.text.length > 0
        ? { kind: "type", text: args.text }
        : "text must be a non-empty string.";
    case "key": {
      const text = nonEmpty(args.text);
      if (text === undefined) return 'text must name a key, e.g. "Return" or "ctrl+s".';
      const repeat =
        typeof args.repeat === "number" && Number.isInteger(args.repeat)
          ? Math.min(100, Math.max(1, args.repeat))
          : undefined;
      return { kind: "key", text, ...(repeat === undefined ? {} : { repeat }) };
    }
    case "open_application": {
      const app = nonEmpty(args.app);
      return app === undefined
        ? "app must name an application."
        : { kind: "open_application", name: app };
    }
    default:
      return `Unknown computer-use tool: ${name}.`;
  }
}

export interface McpCallToolResult {
  readonly isError?: boolean;
  readonly content: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  >;
}

const errorResult = (text: string): McpCallToolResult => ({
  isError: true,
  content: [{ type: "text", text }],
});

const toolResult = (result: ComputerUseActionResult): McpCallToolResult => ({
  content: [
    { type: "text", text: result.text },
    ...(result.screenshot === undefined
      ? []
      : [
          {
            type: "image" as const,
            data: result.screenshot.data,
            mimeType: result.screenshot.mimeType,
          },
        ]),
  ],
});

export const COMPUTER_USE_DISABLED_MESSAGE =
  "Computer use is turned off. The user can turn it on in Settings.";

export const callComputerUseTool = (input: {
  readonly channel: ComputerUseChannel["Service"];
  readonly enabled: boolean;
  readonly threadId: string;
  readonly agentName?: string;
  readonly name: string;
  readonly arguments: unknown;
}): Effect.Effect<McpCallToolResult> => {
  if (!input.enabled) return Effect.succeed(errorResult(COMPUTER_USE_DISABLED_MESSAGE));
  const action = computerUseActionFromToolCall(input.name, input.arguments);
  if (typeof action === "string") return Effect.succeed(errorResult(action));
  return input.channel
    .invoke({
      threadId: input.threadId,
      ...(input.agentName === undefined ? {} : { agentName: input.agentName }),
      action,
    })
    .pipe(
      Effect.map(toolResult),
      Effect.catch((error) => Effect.succeed(errorResult(error.message))),
    );
};

export const listComputerUseTools = (input: {
  readonly channel: ComputerUseChannel["Service"];
  readonly enabled: boolean;
}) =>
  input.enabled && input.channel.available
    ? COMPUTER_USE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: true },
      }))
    : [];
