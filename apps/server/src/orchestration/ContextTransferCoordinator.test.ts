import {
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  buildImageViewerPrompt,
  buildContextTransferPrompt,
  buildContextTransferSourceContext,
  ContextTransferStore,
  requiresContextTransfer,
} from "./ContextTransferCoordinator.ts";

describe("ContextTransferCoordinator", () => {
  it("transfers only when the native provider instance changes", () => {
    expect(
      requiresContextTransfer({
        sourceInstanceId: ProviderInstanceId.make("codex"),
        targetInstanceId: ProviderInstanceId.make("codex"),
      }),
    ).toBe(false);
    expect(
      requiresContextTransfer({
        sourceInstanceId: ProviderInstanceId.make("codex"),
        targetInstanceId: ProviderInstanceId.make("claudeAgent"),
      }),
    ).toBe(true);
  });

  it("wraps prior thread context and the original request in one invisible handoff prompt", () => {
    const thread = {
      title: "Fix provider switching",
      branch: "main",
      worktreePath: "C:/repo",
      messages: [
        { role: "user", text: "Keep one visual thread" },
        { role: "assistant", text: "I updated the provider picker" },
        { role: "user", text: "Now continue in Claude" },
      ],
      activities: [{ summary: "Edited ChatView.tsx", payload: { detail: "Picker unlocked" } }],
    } as unknown as OrchestrationThread;

    const request = {
      sourceProvider: ProviderDriverKind.make("codex"),
      sourceInstanceId: ProviderInstanceId.make("codex"),
      sourceModel: "gpt-5.4",
      targetProvider: ProviderDriverKind.make("claudeAgent"),
      targetInstanceId: ProviderInstanceId.make("claudeAgent"),
      targetModel: "claude-opus-4-6",
      originalPrompt: "Now continue in Claude",
    };
    const evidence = buildContextTransferSourceContext(thread, request);
    const result = buildContextTransferPrompt(
      "Current objective: Keep one visual thread.\nPending tasks: Continue in Claude.",
      request.originalPrompt,
    );

    expect(result).toContain("<context-transfer>");
    expect(evidence).toContain("ASSISTANT:\nI updated the provider picker");
    expect(evidence).not.toContain("USER:\nNow continue in Claude");
    expect(result).toContain("<user-request>\nNow continue in Claude\n</user-request>");
  });

  it("persists transfer state and reuses a completed summary", () => {
    const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sealcode-transfer-"));
    try {
      const request = {
        sourceProvider: ProviderDriverKind.make("codex"),
        sourceInstanceId: ProviderInstanceId.make("codex"),
        sourceModel: "gpt-5.6-sol",
        targetProvider: ProviderDriverKind.make("antigravity"),
        targetInstanceId: ProviderInstanceId.make("antigravity"),
        targetModel: "gemini-3.6-flash-high",
        originalPrompt: "Continue",
      };
      const store = new ContextTransferStore(stateDir);
      store.begin("message-1", "thread-1", request, "2026-01-01T00:00:00.000Z");
      store.markRunning("message-1", "2026-01-01T00:00:01.000Z");
      store.complete("message-1", "Current objective: Continue.", "2026-01-01T00:00:02.000Z");

      const restored = new ContextTransferStore(stateDir).get("message-1");
      expect(restored?.state).toBe("completed");
      expect(restored?.summary).toBe("Current objective: Continue.");
    } finally {
      NodeFS.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps an image viewer description separate from the original request", () => {
    expect(
      buildImageViewerPrompt({
        originalPrompt: "Implement this layout",
        description: "A compact dark composer with violet controls.",
      }),
    ).toBe(
      "<image-viewer-description>\nA compact dark composer with violet controls.\n</image-viewer-description>\n\n<user-request>\nImplement this layout\n</user-request>",
    );
  });
});
