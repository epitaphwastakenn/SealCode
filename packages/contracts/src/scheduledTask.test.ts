import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ScheduledTaskSchedule,
  ScheduledTaskUpsertSchedule,
} from "./scheduledTask.ts";

const decodeSchedule = Schema.decodeUnknownSync(ScheduledTaskSchedule);
const decodeUpsertSchedule = Schema.decodeUnknownSync(ScheduledTaskUpsertSchedule);

describe("ScheduledTaskSchedule", () => {
  it("keeps legacy sub-minute persisted schedules readable", () => {
    expect(
      decodeSchedule({
        type: "interval",
        everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
      }),
    ).toEqual({
      type: "interval",
      everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
    });
  });

  it("still reads a saved webhook schedule, ignoring its removed settings", () => {
    expect(
      decodeSchedule({
        type: "webhook",
        signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
        maxDeliveryAgeMinutes: 30,
        dedupe: { replayKey: "{{headers.x-id}}" },
        filters: [{ path: "body.action", op: "equals", value: "opened" }],
      }),
    ).toEqual({ type: "webhook" });
  });

  it("does not accept a webhook schedule on save", () => {
    expect(() => decodeUpsertSchedule({ type: "webhook" })).toThrow();
  });
});
