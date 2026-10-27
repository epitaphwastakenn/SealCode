import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ScheduledTaskId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const savedWebhookSchedule = JSON.stringify({
  type: "webhook",
  signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
  maxDeliveryAgeMinutes: 30,
  dedupe: { replayKey: "{{headers.x-github-delivery}}" },
  filters: [{ path: "body.action", op: "equals", value: "opened" }],
});

const taskId = ScheduledTaskId.make("task:saved-webhook");
const now = "2026-09-09T12:00:00.000Z";

const insertSavedWebhookTask = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
      task_id: taskId,
      title: "On pull request",
      prompt: "Review {{body.number}}",
      enabled: 1,
      schedule_json: savedWebhookSchedule,
      project_id: "project:test",
      thread_id: null,
      workspace_strategy_json: '{"type":"root"}',
      model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
      runtime_mode: "full-access",
      interaction_mode: "default",
      created_by: "user",
      creation_source: "web",
      created_at: now,
      updated_at: now,
      next_run_at: now,
      last_run_at: null,
      last_run_status: "never",
      last_run_error: null,
      run_count: 0,
      webhook_token: "url-token",
      webhook_secret: "signing-secret",
    })}`;
    yield* sql`INSERT INTO scheduled_task_webhook_deliveries ${sql.insert({
      delivery_id: "delivery:1",
      task_id: taskId,
      received_at: now,
      method: "POST",
      query: "",
      headers_json: "{}",
      body: "{}",
      body_bytes: 2,
      body_truncated: 0,
      outcome: "accepted",
      signature_verified: 1,
      missing_fields_json: "[]",
    })}`;
  });

const layer = ScheduledTaskService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: () => Effect.die("a removed webhook task must never launch"),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      NodeCrypto.layer,
      Scheduler.layer,
    ),
  ),
);

it.effect("loads a saved webhook task as paused and drops its URL token and signing secret", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* insertSavedWebhookTask(sql);
    yield* TestClock.setTime(Date.parse(now) + 1_000);

    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      // The scheduler would have fired the task by now if it were still armed.
      yield* TestClock.adjust("6 seconds");

      const { tasks } = yield* service.list();
      assert.lengthOf(tasks, 1);
      const [task] = tasks;
      assert.deepEqual(task?.schedule, { type: "webhook" });
      assert.isFalse(task?.enabled);
      assert.isNull(task?.nextRunAt);
      assert.equal(task?.lastRunStatus, "never");
      assert.equal(task?.runCount, 0);

      const rows = yield* sql<{
        enabled: number;
        next_run_at: string | null;
        webhook_token: string | null;
        webhook_secret: string | null;
      }>`SELECT enabled, next_run_at, webhook_token, webhook_secret FROM scheduled_tasks`;
      assert.deepEqual(rows, [
        { enabled: 0, next_run_at: null, webhook_token: null, webhook_secret: null },
      ]);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("cannot enable or run a saved webhook task, but can convert or delete it", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* insertSavedWebhookTask(sql);

    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;

      const enable = yield* service.setEnabled({ id: taskId, enabled: true }).pipe(Effect.flip);
      assert.include(enable.message, "no longer supported");
      const run = yield* service.runNow({ id: taskId }).pipe(Effect.flip);
      assert.include(run.message, "no longer supported");
      assert.equal((yield* service.list()).tasks[0]?.schedule.type, "webhook");

      const { task: converted } = yield* service.upsert({
        id: taskId,
        title: "On pull request",
        prompt: "Review open pull requests",
        enabled: true,
        schedule: { type: "interval", everyMs: 3_600_000 },
        projectId: ProjectId.make("project:test"),
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      assert.deepEqual(converted.schedule, { type: "interval", everyMs: 3_600_000 });
      assert.isTrue(converted.enabled);
      assert.isNotNull(converted.nextRunAt);

      yield* service.delete({ id: taskId });
      assert.lengthOf((yield* service.list()).tasks, 0);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("does not touch unrelated tasks when pausing saved webhook tasks", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* insertSavedWebhookTask(sql);
    yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
      task_id: "task:hourly",
      title: "Hourly",
      prompt: "Check",
      enabled: 1,
      schedule_json: '{"type":"interval","everyMs":3600000}',
      project_id: "project:test",
      thread_id: null,
      workspace_strategy_json: '{"type":"root"}',
      model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
      runtime_mode: "full-access",
      interaction_mode: "default",
      created_by: "user",
      creation_source: "web",
      created_at: now,
      updated_at: now,
      next_run_at: "2026-09-09T13:00:00.000Z",
      last_run_at: null,
      last_run_status: "never",
      last_run_error: null,
      run_count: 0,
    })}`;

    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const byId = new Map((yield* service.list()).tasks.map((task) => [task.id, task]));
      const hourly = byId.get(ScheduledTaskId.make("task:hourly"));
      assert.isTrue(hourly?.enabled);
      assert.equal(hourly?.nextRunAt, "2026-09-09T13:00:00.000Z");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
