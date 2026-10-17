import * as Effect from "effect/Effect";

import * as HarnessStore from "../../McpHarnessStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { HarnessToolkit } from "./tools.ts";

const contextAndStore = Effect.all({
  context: McpInvocationContext.requireMcpCapability("harness"),
  store: HarnessStore.McpHarnessStore,
});

const asToolError = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Harness tool failed.";

const toolEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(asToolError));

const handlers = {
  skill_list: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.listSkills({
        threadId: context.threadId,
        ...(context.workspaceRoot === undefined ? {} : { workspaceRoot: context.workspaceRoot }),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
      });
    })),
  skill_view: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.readSkill({ threadId: context.threadId, scope: input.scope, name: input.name,
        ...(context.workspaceRoot === undefined ? {} : { workspaceRoot: context.workspaceRoot }) });
    })),
  skill_propose: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.createSkillProposal({
        threadId: context.threadId,
        ...(context.workspaceRoot === undefined ? {} : { workspaceRoot: context.workspaceRoot }),
        scope: input.scope,
        name: input.name,
        body: input.body,
        reason: input.reason,
      });
    })),
  skill_manage: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      if (input.action === "delete") {
        yield* store.deleteSkill({ threadId: context.threadId, scope: input.scope, name: input.name,
          ...(context.workspaceRoot === undefined ? {} : { workspaceRoot: context.workspaceRoot }) });
        return { deleted: true, name: input.name };
      }
      if (input.body === undefined) return yield* Effect.fail("body is required for save");
      return yield* store.saveSkill({
        threadId: context.threadId,
        ...(context.workspaceRoot === undefined ? {} : { workspaceRoot: context.workspaceRoot }),
        scope: input.scope,
        name: input.name,
        body: input.body,
      });
    })),
  session_search: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.searchSessions({
        query: input.query,
        threadId: context.threadId,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
    })),
  session_open: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.openSessionMessage({
        threadId: context.threadId,
        messageId: input.messageId,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
      });
    })),
  memory_view: () =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.listMemory({ threadId: context.threadId });
    })),
  memory_propose: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.createMemoryProposal({
        threadId: context.threadId,
        scope: input.scope,
        key: input.key,
        value: input.value,
        reason: input.reason,
      });
    })),
  memory_manage: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      if (input.action === "approve") {
        if (input.proposalId === undefined) return yield* Effect.fail("proposalId is required for approve");
        return yield* store.approveMemoryProposal({ threadId: context.threadId, id: input.proposalId });
      }
      if (input.key === undefined) return yield* Effect.fail("key is required for save or delete");
      if (input.action === "delete") {
        yield* store.deleteMemory({
          key: input.key,
          ...(input.scope === "project" ? { threadId: context.threadId } : {}),
        });
        return { deleted: true, key: input.key };
      }
      if (input.value === undefined) return yield* Effect.fail("value is required for save");
      return yield* store.upsertMemory({
        key: input.key,
        value: input.value,
        ...(input.scope === "project" ? { threadId: context.threadId } : {}),
        ...(input.source === undefined ? {} : { source: input.source }),
      });
    })),
  artifact_read: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      const bytes = yield* store.readArtifact({
        threadId: context.threadId,
        id: input.id,
        ...(input.start === undefined ? {} : { start: input.start }),
        ...(input.end === undefined ? {} : { end: input.end }),
      });
      return { mimeType: "application/octet-stream", base64: Buffer.from(bytes).toString("base64") };
    })),
  execute_workflow: (input) =>
    toolEffect(Effect.gen(function* () {
      const { context, store } = yield* contextAndStore;
      return yield* store.executeWorkflow({
        threadId: context.threadId,
        ...(context.workspaceRoot === undefined ? {} : { workspaceRoot: context.workspaceRoot }),
        definition: input,
      });
    })),
} satisfies Parameters<typeof HarnessToolkit.toLayer>[0];

export const HarnessToolkitHandlersLive = HarnessToolkit.toLayer(handlers);
