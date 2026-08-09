import type {
  OrchestrationThread,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const MAX_CONTEXT_TRANSFER_CHARS = 16_000;
const MAX_CONTEXT_TRANSFER_MESSAGES = 16;
const MAX_CONTEXT_TRANSFER_ACTIVITIES = 20;
const TRUNCATION_MARKER = "[Earlier context omitted]";
const NATIVE_SESSION_STORE_FILENAME = "native-provider-sessions.json";
const CONTEXT_TRANSFER_STORE_FILENAME = "context-transfers.json";

type PersistedNativeSession = {
  readonly resumeCursor: unknown;
  readonly updatedAt: string;
};

type PersistedNativeSessions = Record<string, PersistedNativeSession>;

export class NativeProviderSessionStore {
  readonly #filePath: string;
  readonly #sessions: Map<string, PersistedNativeSession>;

  constructor(stateDir: string) {
    this.#filePath = NodePath.join(stateDir, NATIVE_SESSION_STORE_FILENAME);
    const persisted: PersistedNativeSessions = NodeFS.existsSync(this.#filePath)
      ? (JSON.parse(NodeFS.readFileSync(this.#filePath, "utf8")) as PersistedNativeSessions)
      : {};
    this.#sessions = new Map(Object.entries(persisted));
  }

  get(threadId: string, instanceId: string): unknown | undefined {
    return this.#sessions.get(`${threadId}:${instanceId}`)?.resumeCursor;
  }

  set(threadId: string, instanceId: string, resumeCursor: unknown, updatedAt: string): void {
    this.#sessions.set(`${threadId}:${instanceId}`, { resumeCursor, updatedAt });
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    NodeFS.writeFileSync(
      temporaryPath,
      `${JSON.stringify(Object.fromEntries(this.#sessions), null, 2)}\n`,
      "utf8",
    );
    NodeFS.renameSync(temporaryPath, this.#filePath);
  }
}

export interface ContextTransferRequest {
  readonly sourceProvider: ProviderDriverKind;
  readonly sourceInstanceId: ProviderInstanceId;
  readonly sourceModel: string | undefined;
  readonly targetProvider: ProviderDriverKind;
  readonly targetInstanceId: ProviderInstanceId;
  readonly targetModel: string;
  readonly originalPrompt: string;
}

export type ContextTransferState = "pending" | "running" | "completed" | "failed";

export interface PersistedContextTransfer extends ContextTransferRequest {
  readonly id: string;
  readonly threadId: string;
  readonly summary: string | null;
  readonly state: ContextTransferState;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ContextTransferStore {
  readonly #filePath: string;
  readonly #records: Map<string, PersistedContextTransfer>;

  constructor(stateDir: string) {
    this.#filePath = NodePath.join(stateDir, CONTEXT_TRANSFER_STORE_FILENAME);
    const persisted = NodeFS.existsSync(this.#filePath)
      ? (JSON.parse(NodeFS.readFileSync(this.#filePath, "utf8")) as Record<
          string,
          PersistedContextTransfer
        >)
      : {};
    this.#records = new Map(Object.entries(persisted));
  }

  get(id: string): PersistedContextTransfer | undefined {
    return this.#records.get(id);
  }

  begin(
    id: string,
    threadId: string,
    request: ContextTransferRequest,
    now: string,
  ): PersistedContextTransfer {
    const existing = this.#records.get(id);
    if (existing) return existing;
    const record: PersistedContextTransfer = {
      id,
      threadId,
      ...request,
      summary: null,
      state: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#records.set(id, record);
    this.#flush();
    return record;
  }

  markRunning(id: string, now: string): PersistedContextTransfer {
    return this.#update(id, { state: "running", error: null, updatedAt: now });
  }

  complete(id: string, summary: string, now: string): PersistedContextTransfer {
    return this.#update(id, {
      state: "completed",
      summary: summary.trim(),
      error: null,
      updatedAt: now,
    });
  }

  fail(id: string, error: string, now: string): PersistedContextTransfer {
    return this.#update(id, { state: "failed", error, updatedAt: now });
  }

  #update(id: string, patch: Partial<PersistedContextTransfer>): PersistedContextTransfer {
    const current = this.#records.get(id);
    if (!current) throw new Error(`Context transfer '${id}' was not found.`);
    const next = { ...current, ...patch };
    this.#records.set(id, next);
    this.#flush();
    return next;
  }

  #flush(): void {
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    NodeFS.writeFileSync(
      temporaryPath,
      `${JSON.stringify(Object.fromEntries(this.#records), null, 2)}\n`,
      "utf8",
    );
    NodeFS.renameSync(temporaryPath, this.#filePath);
  }
}

export function buildImageViewerPrompt(input: {
  readonly originalPrompt: string;
  readonly description: string;
}): string {
  return `<image-viewer-description>\n${input.description.trim()}\n</image-viewer-description>\n\n<user-request>\n${input.originalPrompt}\n</user-request>`;
}

export function requiresContextTransfer(input: {
  readonly sourceInstanceId: ProviderInstanceId | undefined;
  readonly sourceModel: string | undefined;
  readonly targetInstanceId: ProviderInstanceId;
  readonly targetModel: string;
}): boolean {
  return (
    input.sourceInstanceId !== undefined &&
    (input.sourceInstanceId !== input.targetInstanceId ||
      (input.sourceModel !== undefined && input.sourceModel !== input.targetModel))
  );
}

function renderActivity(activity: OrchestrationThread["activities"][number]): string {
  const detail =
    typeof activity.payload === "object" &&
    activity.payload !== null &&
    "detail" in activity.payload &&
    typeof activity.payload.detail === "string"
      ? `: ${activity.payload.detail}`
      : "";
  return `- ${activity.summary}${detail}`;
}

function trimTransferContext(value: string): string {
  if (value.length <= MAX_CONTEXT_TRANSFER_CHARS) {
    return value;
  }
  return `${TRUNCATION_MARKER}\n${value.slice(-(MAX_CONTEXT_TRANSFER_CHARS - TRUNCATION_MARKER.length - 1))}`;
}

export function buildContextTransferSourceContext(
  thread: OrchestrationThread,
  request: ContextTransferRequest,
): string {
  const priorMessages = thread.messages
    .slice(0, -1)
    .filter((message) => message.role !== "system")
    .slice(-MAX_CONTEXT_TRANSFER_MESSAGES)
    .map((message) => `${message.role.toUpperCase()}:\n${message.text.trim()}`)
    .filter((message) => !message.endsWith(":\n"));
  const recentActivities = thread.activities
    .slice(-MAX_CONTEXT_TRANSFER_ACTIVITIES)
    .map(renderActivity);
  const objective = thread.messages.find((message) => message.role === "user")?.text.trim();
  return trimTransferContext(
    [
      `Objective: ${objective || thread.title}`,
      `Project state: thread "${thread.title}", branch ${thread.branch ?? "none"}, workspace ${thread.worktreePath ?? "project root"}.`,
      `Source: ${request.sourceProvider}/${request.sourceInstanceId}${request.sourceModel ? ` (${request.sourceModel})` : ""}.`,
      `Target: ${request.targetProvider}/${request.targetInstanceId} (${request.targetModel}).`,
      "Recent conversation:",
      priorMessages.length > 0 ? priorMessages.join("\n\n") : "No prior messages.",
      "Recent runtime results:",
      recentActivities.length > 0 ? recentActivities.join("\n") : "No recorded runtime activity.",
    ].join("\n\n"),
  );
}

export function buildContextTransferPrompt(summary: string, originalPrompt: string): string {
  return `<context-transfer>\n${summary.trim()}\n</context-transfer>\n\n<user-request>\n${originalPrompt}\n</user-request>`;
}
