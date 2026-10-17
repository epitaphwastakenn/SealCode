import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderSendTurnInput,
  type ProviderSession,
} from "@t3tools/contracts";
import { commandArgs, missingFinalAssistantText } from "./HeadlessCliAdapter.ts";
import { capabilitiesForEffortLevels } from "./HeadlessCliProvider.ts";

const threadId = ThreadId.make("thread-headless-cli");
const commandCodeInstance = ProviderInstanceId.make("commandcode");
const commandCodeProvider = ProviderDriverKind.make("commandcode");
const session: ProviderSession = {
  provider: commandCodeProvider,
  providerInstanceId: commandCodeInstance,
  status: "ready",
  runtimeMode: "full-access",
  threadId,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};
function sendTurn(model: string): ProviderSendTurnInput {
  return {
    threadId,
    input: "hello & goodbye",
    modelSelection: {
      instanceId: commandCodeInstance,
      model,
      options: [{ id: "effort", value: "medium" }],
    },
  };
}

function sendTurnWithEffort(model: string, effort: string): ProviderSendTurnInput {
  const input = sendTurn(model);
  if (!input.modelSelection) return input;
  return {
    ...input,
    modelSelection: {
      ...input.modelSelection,
      options: [{ id: "effort", value: effort }],
    },
  };
}

describe("CommandCode headless CLI arguments", () => {
  it("does not pass reasoning effort to unsupported models", () => {
    const args = commandArgs({
      protocol: "commandcode",
      prompt: "hello & goodbye",
      send: sendTurn("qwen/qwen3.7-flash"),
      session,
    });

    expect(args).not.toContain("--effort");
    expect(args).not.toContain("medium");
  });

  it("keeps reasoning effort for supported models", () => {
    const args = commandArgs({
      protocol: "commandcode",
      prompt: "hello",
      send: sendTurnWithEffort("deepseek/deepseek-v4-flash", "high"),
      session,
      capabilities: capabilitiesForEffortLevels(["high", "max"]),
    });

    expect(args).toContain("--effort");
    expect(args).toContain("high");
  });

  it("drops a stale effort after switching to a model with different levels", () => {
    const args = commandArgs({
      protocol: "commandcode",
      prompt: "hello",
      send: sendTurn("deepseek/deepseek-v4-flash"),
      session,
      capabilities: capabilitiesForEffortLevels(["high", "max"]),
    });

    expect(args).not.toContain("--effort");
  });

  it("passes the levels discovered for Muse Spark", () => {
    const args = commandArgs({
      protocol: "commandcode",
      prompt: "hello",
      send: sendTurn("meta/muse-spark-1.1"),
      session,
      capabilities: capabilitiesForEffortLevels(["minimal", "low", "medium", "high", "xhigh"]),
    });

    expect(args).toContain("--effort");
    expect(args).toContain("medium");
  });

  it("does not pass --add-dir even when the session has a cwd", () => {
    const args = commandArgs({
      protocol: "commandcode",
      prompt: "hello",
      send: sendTurn("qwen/qwen3.7-flash"),
      session: { ...session, cwd: NodePath.resolve("/tmp/commandcode-project") },
    });

    expect(args).not.toContain("--add-dir");
  });
});

describe("headless final response reconciliation", () => {
  it("does not duplicate a final response already at the end of the stream", () => {
    expect(
      missingFinalAssistantText("thinking\nfinal answer", "final answer", "final answer"),
    ).toBe("");
  });

  it("returns the missing suffix when a result frame contains the complete response", () => {
    expect(missingFinalAssistantText("partial", "partial", "partial response")).toBe(" response");
  });

  it("does not suppress a final response that only appeared in commentary", () => {
    expect(
      missingFinalAssistantText("thinking mentions final answer here", "", "final answer"),
    ).toBe("final answer");
  });

  it("backfills a result.response that never appeared as text_delta", () => {
    expect(
      missingFinalAssistantText(
        "",
        "",
        "Git rebase destructively rewrites a branch's commit history.\n",
      ),
    ).toBe("Git rebase destructively rewrites a branch's commit history.\n");
  });
});
