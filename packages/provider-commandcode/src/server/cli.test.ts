import { describe, expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type ModelSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";

import {
  commandCodeArgs,
  commandCodeFailure,
  commandCodeToolText,
  parseCommandCodeFrame,
  resolveCommandCodeEffort,
} from "./cli.ts";
import { commandCodeModelCapabilities } from "./models.ts";

const baseArgs = {
  resumeSessionId: null,
  model: undefined,
  effort: undefined,
  runtimeMode: "approval-required",
  interactionMode: "default",
} as const;

const selection = (model: string, effort?: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("commandcode"),
  model,
  ...(effort === undefined ? {} : { options: [{ id: "effort", value: effort }] }),
});

const model = (slug: string, efforts: ReadonlyArray<string>): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: commandCodeModelCapabilities(efforts),
});

describe("commandCodeArgs", () => {
  it("reads the prompt from stdin by ending on a bare --print", () => {
    const args = commandCodeArgs(baseArgs);
    expect(args.at(-1)).toBe("--print");
    expect(args).toEqual([
      "--no-auto-update",
      "--skip-onboarding",
      "--trust",
      "--output-format",
      "json",
      "--print",
    ]);
  });

  it("resumes the stored session on the selected model and effort", () => {
    const args = commandCodeArgs({
      ...baseArgs,
      resumeSessionId: "9f4e1c0a",
      model: "meta/muse-spark-1.2-contributor",
      effort: "high",
    });
    expect(args.join(" ")).toContain("--resume 9f4e1c0a --model meta/muse-spark-1.2-contributor");
    expect(args.join(" ")).toContain("--effort high");
  });

  it("opens writes and commands only for full access", () => {
    expect(commandCodeArgs({ ...baseArgs, runtimeMode: "full-access" })).toContain("--yolo");
    for (const runtimeMode of ["approval-required", "auto-accept-edits", "auto"] as const) {
      const args = commandCodeArgs({ ...baseArgs, runtimeMode });
      expect(args).not.toContain("--yolo");
      expect(args).not.toContain("--auto-accept");
    }
  });

  it("starts plan threads in plan mode", () => {
    expect(commandCodeArgs({ ...baseArgs, interactionMode: "plan" })).toContain("--plan");
  });
});

describe("resolveCommandCodeEffort", () => {
  const models = [model("deepseek/deepseek-v4-flash", ["high", "max"]), model("kimi", [])];

  it("keeps an effort the model advertises, in the model's own spelling", () => {
    expect(resolveCommandCodeEffort(models, selection("deepseek/deepseek-v4-flash", "MAX"))).toBe(
      "max",
    );
  });

  it("drops a stale effort after switching to a model with other levels", () => {
    expect(
      resolveCommandCodeEffort(models, selection("deepseek/deepseek-v4-flash", "medium")),
    ).toBeUndefined();
  });

  it("sends no effort to a model without effort levels or one the catalog lacks", () => {
    expect(resolveCommandCodeEffort(models, selection("kimi", "high"))).toBeUndefined();
    expect(resolveCommandCodeEffort(models, selection("custom/model", "high"))).toBeUndefined();
  });
});

describe("parseCommandCodeFrame", () => {
  it("reads an event frame and the final result frame", () => {
    expect(
      parseCommandCodeFrame('{"type":"event","event":{"type":"text_delta","delta":"hi"}}'),
    ).toEqual({ type: "event", event: { type: "text_delta", delta: "hi" } });
    expect(
      parseCommandCodeFrame(
        '{"type":"result","subtype":"success","sessionId":"s-1","finalText":"done","usage":{}}',
      ),
    ).toEqual({
      type: "result",
      result: { subtype: "success", sessionId: "s-1", finalText: "done", error: undefined },
    });
  });

  it("treats a result without a session id as an early failure", () => {
    expect(
      parseCommandCodeFrame('{"type":"result","subtype":"error","error":"Error: nope"}'),
    ).toEqual({
      type: "result",
      result: { subtype: "error", sessionId: undefined, finalText: "", error: "Error: nope" },
    });
  });

  it("ignores lines that are not frames", () => {
    expect(parseCommandCodeFrame("not json")).toBeUndefined();
    expect(parseCommandCodeFrame("[1,2]")).toBeUndefined();
    expect(parseCommandCodeFrame('{"type":"banner"}')).toBeUndefined();
    expect(parseCommandCodeFrame('{"type":"event"}')).toBeUndefined();
  });
});

describe("commandCodeToolText", () => {
  it("joins the text blocks of a tool result", () => {
    expect(
      commandCodeToolText([
        { type: "text", text: "a" },
        { type: "image", data: "ignored" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
    expect(commandCodeToolText([])).toBeUndefined();
    expect(commandCodeToolText("plain")).toBe("plain");
  });
});

describe("commandCodeFailure", () => {
  const errorResult = (error: string) => ({
    subtype: "error",
    sessionId: undefined,
    finalText: "",
    error,
  });

  it("does not fail a run the CLI reports as successful", () => {
    expect(
      commandCodeFailure({
        result: { subtype: "success", sessionId: "s", finalText: "ok", error: undefined },
        exitCode: 9,
        stderr: "",
        runError: undefined,
      }),
    ).toBeNull();
  });

  it.each([
    [3, "permission_error"],
    [4, "permission_error"],
    [5, "usage_limit"],
    [10, "usage_limit"],
    [6, "transport_error"],
    [7, "provider_error"],
    [1, "provider_error"],
  ] as const)("classifies exit code %s as %s", (exitCode, expectedClass) => {
    const failure = commandCodeFailure({
      result: errorResult("Error: boom"),
      exitCode,
      stderr: "",
      runError: undefined,
    });
    expect(failure?.class).toBe(expectedClass);
    expect(failure?.code).toBe(`exit_${exitCode}`);
  });

  it("explains a missing sign-in without echoing the CLI's own command name", () => {
    const failure = commandCodeFailure({
      result: errorResult('Error: Authentication failed. Please run "cmdc login" first.'),
      exitCode: 3,
      stderr: "",
      runError: undefined,
    });
    expect(failure?.message).toContain("commandcode login");
  });

  it("reports a reached turn limit as a failure that can be continued", () => {
    const failure = commandCodeFailure({
      result: { subtype: "max_turns", sessionId: "s", finalText: "partial", error: undefined },
      exitCode: 8,
      stderr: "",
      runError: undefined,
    });
    expect(failure?.class).toBe("provider_error");
    expect(failure?.message).toContain("turn limit");
  });

  it("falls back to stderr, then to the exit code, when no result arrived", () => {
    expect(
      commandCodeFailure({
        result: undefined,
        exitCode: 1,
        stderr: "Error: kaboom\n",
        runError: undefined,
      })?.message,
    ).toBe("kaboom");
    expect(
      commandCodeFailure({ result: undefined, exitCode: 2, stderr: "", runError: undefined })
        ?.message,
    ).toBe("CommandCode exited with code 2.");
    expect(
      commandCodeFailure({
        result: undefined,
        exitCode: undefined,
        stderr: "",
        runError: undefined,
      })?.message,
    ).toBe("CommandCode stopped without a result.");
  });
});
