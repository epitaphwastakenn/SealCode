import { assert, describe, it } from "@effect/vitest";
import type { ComputerUseAction } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { ComputerUseChannel, ComputerUseError } from "./ComputerUseChannel.ts";
import {
  COMPUTER_USE_DISABLED_MESSAGE,
  callComputerUseTool,
  computerUseActionFromToolCall,
  listComputerUseTools,
} from "./ComputerUseTools.ts";

const recordingChannel = (available = true) => {
  const invoked: Array<{ threadId: string; action: ComputerUseAction }> = [];
  const channel = ComputerUseChannel.of({
    available,
    invoke: (input) => {
      invoked.push(input);
      return input.action.kind === "screenshot"
        ? Effect.succeed({
            text: "Screen 1456x819.",
            screenshot: { data: "AAAA", mimeType: "image/jpeg", width: 1456, height: 819 },
          })
        : Effect.succeed({ text: `done ${input.action.kind}` });
    },
    end: () => Effect.void,
    stops: Stream.empty,
  });
  return { channel, invoked };
};

describe("computer-use tool gating", () => {
  it("lists no tools while the setting is off or no desktop is attached", () => {
    assert.lengthOf(
      listComputerUseTools({ channel: recordingChannel().channel, enabled: false }),
      0,
    );
    assert.lengthOf(
      listComputerUseTools({ channel: recordingChannel(false).channel, enabled: true }),
      0,
    );
    const names = listComputerUseTools({ channel: recordingChannel().channel, enabled: true }).map(
      (tool) => tool.name,
    );
    assert.includeMembers(names, [
      "request_access",
      "screenshot",
      "left_click",
      "type",
      "key",
      "open_application",
      "list_granted_applications",
    ]);
  });

  it.effect("refuses calls without reaching the desktop while the setting is off", () =>
    Effect.gen(function* () {
      const { channel, invoked } = recordingChannel();
      const result = yield* callComputerUseTool({
        channel,
        enabled: false,
        threadId: "thread-a",
        name: "screenshot",
        arguments: {},
      });
      assert.isTrue(result.isError);
      assert.deepEqual(result.content, [{ type: "text", text: COMPUTER_USE_DISABLED_MESSAGE }]);
      assert.lengthOf(invoked, 0);
    }),
  );

  it.effect("dispatches the decoded action for the calling thread", () =>
    Effect.gen(function* () {
      const { channel, invoked } = recordingChannel();
      const result = yield* callComputerUseTool({
        channel,
        enabled: true,
        threadId: "thread-a",
        name: "double_click",
        arguments: { coordinate: [100, 200], text: "ctrl" },
      });
      assert.isUndefined(result.isError);
      assert.deepEqual(invoked, [
        {
          threadId: "thread-a",
          action: { kind: "click", button: "left", count: 2, x: 100, y: 200, modifiers: "ctrl" },
        },
      ]);
    }),
  );

  it.effect("returns screenshots as image content", () =>
    Effect.gen(function* () {
      const result = yield* callComputerUseTool({
        channel: recordingChannel().channel,
        enabled: true,
        threadId: "thread-a",
        name: "screenshot",
        arguments: {},
      });
      assert.deepEqual(result.content, [
        { type: "text", text: "Screen 1456x819." },
        { type: "image", data: "AAAA", mimeType: "image/jpeg" },
      ]);
    }),
  );

  it.effect("reports the desktop's errors as tool errors", () =>
    Effect.gen(function* () {
      const channel = ComputerUseChannel.of({
        available: false,
        invoke: () => Effect.fail(new ComputerUseError({ message: "needs the desktop app" })),
        end: () => Effect.void,
        stops: Stream.empty,
      });
      const result = yield* callComputerUseTool({
        channel,
        enabled: true,
        threadId: "thread-a",
        name: "screenshot",
        arguments: {},
      });
      assert.isTrue(result.isError);
      assert.deepEqual(result.content, [{ type: "text", text: "needs the desktop app" }]);
    }),
  );
});

describe("computerUseActionFromToolCall", () => {
  it("decodes Claude-style arguments", () => {
    assert.deepEqual(
      computerUseActionFromToolCall("left_click_drag", {
        start_coordinate: [1, 2],
        coordinate: [3, 4],
      }),
      { kind: "left_click_drag", startX: 1, startY: 2, x: 3, y: 4 },
    );
    assert.deepEqual(
      computerUseActionFromToolCall("scroll", { coordinate: [5, 6], scroll_direction: "down" }),
      { kind: "scroll", x: 5, y: 6, direction: "down", amount: 3 },
    );
    assert.deepEqual(computerUseActionFromToolCall("open_application", { app: " Paint " }), {
      kind: "open_application",
      name: "Paint",
    });
    assert.deepEqual(
      computerUseActionFromToolCall("request_access", { apps: ["Paint", " ", "Notepad"] }),
      { kind: "request_access", apps: ["Paint", "Notepad"] },
    );
  });

  it("explains malformed arguments instead of guessing", () => {
    assert.include(
      computerUseActionFromToolCall("left_click", { coordinate: [1] }) as string,
      "coordinate",
    );
    assert.include(computerUseActionFromToolCall("request_access", { apps: [] }) as string, "apps");
    assert.include(computerUseActionFromToolCall("zoom", {}) as string, "Unknown");
  });
});
