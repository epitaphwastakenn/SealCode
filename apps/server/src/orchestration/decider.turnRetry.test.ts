import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-15T00:00:00.000Z";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("antigravity_primary"),
        model: "gemini-3.7-flash",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "Finish the task",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

it.layer(NodeServices.layer)("thread.turn.retry decider", (it) => {
  it.effect("retries the existing user message on the fallback without duplicating it", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.retry",
          commandId: CommandId.make("cmd-retry"),
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("message-1"),
          modelSelection: {
            instanceId: ProviderInstanceId.make("antigravity_backup"),
            model: "gemini-3.7-flash",
          },
          createdAt: NOW,
        },
        readModel,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.meta-updated",
        "thread.turn-start-requested",
      ]);
      expect(events.some((event) => event.type === "thread.message-sent")).toBe(false);
    }),
  );
});
