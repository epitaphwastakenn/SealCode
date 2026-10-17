import {
  MemoryProposal,
  SkillProposal,
  type ArtifactRef,
  type MemoryEntry,
  type MemorySnapshot,
  type ProjectId,
  type SessionSearchQuery,
  type SessionSearchMessage,
  type SessionSearchResult,
  type SkillDocument,
  type SkillSummary,
  type ThreadId,
  type WorkflowDefinition,
  type WorkflowResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";

const MAX_SKILL_BODY_CHARS = 32_000;
const MAX_MEMORY_VALUE_CHARS = 2_200;
const USER_MEMORY_LIMIT = 1_375;
const MAX_SEARCH_LIMIT = 50;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const slugPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const secretPattern = /(api[_-]?key|access[_-]?token|secret|password|private[_-]?key)\s*[:=]/i;

export class McpHarnessStoreError extends Schema.TaggedErrorClass<McpHarnessStoreError>()(
  "McpHarnessStoreError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const harnessError = (operation: string, detail: string, cause?: unknown) =>
  new McpHarnessStoreError({ operation, detail, ...(cause === undefined ? {} : { cause }) });

const decodeMemoryProposal = Schema.decodeUnknownEffect(Schema.fromJsonString(MemoryProposal));
const encodeMemoryProposal = Schema.encodeEffect(Schema.fromJsonString(MemoryProposal));
const encodeSkillProposal = Schema.encodeEffect(Schema.fromJsonString(SkillProposal));
const encodeUnknownJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const ArtifactMetadata = Schema.Struct({
  threadId: Schema.String,
  source: Schema.String,
  createdAt: Schema.String,
});
const decodeArtifactMetadata = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactMetadata));
const encodeArtifactMetadata = Schema.encodeEffect(Schema.fromJsonString(ArtifactMetadata));

const sha256Hex = Effect.fn("McpHarnessStore.sha256Hex")(function* (
  crypto: Crypto.Crypto,
  input: string | Uint8Array,
) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return Encoding.encodeHex(yield* crypto.digest("SHA-256", bytes));
});

function resolveWorkflowReferences(value: unknown, outputs: ReadonlyMap<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$op:")) {
    const operationId = value.slice("$op:".length);
    if (!outputs.has(operationId))
      throw new Error(`Workflow reference '${value}' is not available.`);
    return outputs.get(operationId);
  }
  if (Array.isArray(value)) return value.map((item) => resolveWorkflowReferences(item, outputs));
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    const reference = `$op:${record.$ref}`;
    if (!outputs.has(record.$ref))
      throw new Error(`Workflow reference '${reference}' is not available.`);
    return outputs.get(record.$ref);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, resolveWorkflowReferences(item, outputs)]),
  );
}

export const readMemorySnapshot = Effect.fn("McpHarnessStore.readMemorySnapshot")(
  function* (input: {
    readonly threadId: ThreadId;
  }): Effect.fn.Return<MemorySnapshot, McpHarnessStoreError, SqlClient.SqlClient | Crypto.Crypto> {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const projectRows = yield* sql<{ readonly projectId: string }>`
    SELECT project_id AS "projectId"
    FROM projection_threads
    WHERE thread_id = ${input.threadId}
    LIMIT 1
  `.pipe(
      Effect.mapError((cause) =>
        harnessError("read-memory-snapshot-project", "Memory snapshot lookup failed.", cause),
      ),
    );
    const projectId = projectRows[0]?.projectId ?? "";
    const rows = yield* sql<{
      readonly scope: "user" | "project";
      readonly memoryKey: string;
      readonly memoryValue: string;
    }>`
    SELECT
      scope,
      memory_key AS "memoryKey",
      memory_value AS "memoryValue"
    FROM harness_memory
    WHERE (scope = 'user' AND project_id = '')
       OR (scope = 'project' AND project_id = ${projectId})
    ORDER BY updated_at DESC
  `.pipe(
      Effect.mapError((cause) =>
        harnessError("read-memory-snapshot", "Memory snapshot lookup failed.", cause),
      ),
    );

    let userCharacters = 0;
    let projectCharacters = 0;
    const lines: string[] = [];
    for (const row of rows) {
      const limit = row.scope === "user" ? USER_MEMORY_LIMIT : MAX_MEMORY_VALUE_CHARS;
      const used = row.scope === "user" ? userCharacters : projectCharacters;
      const line = `${row.memoryKey}: ${row.memoryValue}`;
      if (used + line.length > limit) continue;
      lines.push(`[${row.scope}] ${line}`);
      if (row.scope === "user") userCharacters += line.length;
      else projectCharacters += line.length;
    }
    const text = lines.join("\n");
    return {
      text,
      userCharacters,
      projectCharacters,
      ...(text.length === 0
        ? {}
        : {
            contentHash: yield* sha256Hex(crypto, text).pipe(
              Effect.mapError((cause) =>
                harnessError("hash-memory-snapshot", "Memory snapshot hashing failed.", cause),
              ),
            ),
          }),
    } satisfies MemorySnapshot;
  },
);

export interface McpSessionSearchPage {
  readonly results: ReadonlyArray<SessionSearchResult>;
  readonly nextCursor?: string;
}

export interface McpHarnessStoreShape {
  readonly listSkills: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string;
    readonly scope?: "user" | "project";
  }) => Effect.Effect<ReadonlyArray<SkillSummary>, McpHarnessStoreError>;
  readonly readSkill: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string;
    readonly scope: "user" | "project";
    readonly name: string;
  }) => Effect.Effect<SkillDocument, McpHarnessStoreError>;
  readonly saveSkill: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string;
    readonly scope: "user" | "project";
    readonly name: string;
    readonly body: string;
  }) => Effect.Effect<SkillDocument, McpHarnessStoreError>;
  readonly deleteSkill: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string;
    readonly scope: "user" | "project";
    readonly name: string;
  }) => Effect.Effect<void, McpHarnessStoreError>;
  readonly createSkillProposal: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string;
    readonly scope: "user" | "project";
    readonly name: string;
    readonly body: string;
    readonly reason: string;
  }) => Effect.Effect<SkillProposal, McpHarnessStoreError>;
  readonly createMemoryProposal: (input: {
    readonly threadId: ThreadId;
    readonly scope: "user" | "project";
    readonly key: string;
    readonly value: string;
    readonly reason: string;
  }) => Effect.Effect<MemoryProposal, McpHarnessStoreError>;
  readonly approveMemoryProposal: (input: {
    readonly threadId: ThreadId;
    readonly id: string;
  }) => Effect.Effect<MemoryEntry, McpHarnessStoreError>;
  readonly searchSessions: (
    input: SessionSearchQuery,
  ) => Effect.Effect<McpSessionSearchPage, McpHarnessStoreError>;
  readonly openSessionMessage: (input: {
    readonly threadId: ThreadId;
    readonly messageId: string;
    readonly scope?: "thread" | "project";
  }) => Effect.Effect<SessionSearchMessage, McpHarnessStoreError>;
  readonly listMemory: (input: {
    readonly projectId?: ProjectId;
    readonly threadId?: ThreadId;
  }) => Effect.Effect<ReadonlyArray<MemoryEntry>, McpHarnessStoreError>;
  readonly upsertMemory: (input: {
    readonly projectId?: ProjectId;
    readonly threadId?: ThreadId;
    readonly key: string;
    readonly value: string;
    readonly source?: string;
  }) => Effect.Effect<MemoryEntry, McpHarnessStoreError>;
  readonly deleteMemory: (input: {
    readonly projectId?: ProjectId;
    readonly threadId?: ThreadId;
    readonly key: string;
  }) => Effect.Effect<void, McpHarnessStoreError>;
  readonly putArtifact: (input: {
    readonly threadId: ThreadId;
    readonly source: string;
    readonly content: string | Uint8Array;
    readonly mediaType?: string;
  }) => Effect.Effect<ArtifactRef, McpHarnessStoreError>;
  readonly readArtifact: (input: {
    readonly threadId: ThreadId;
    readonly id: string;
    readonly start?: number;
    readonly end?: number;
  }) => Effect.Effect<Uint8Array, McpHarnessStoreError>;
  readonly executeWorkflow: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string;
    readonly definition: WorkflowDefinition;
  }) => Effect.Effect<WorkflowResult, McpHarnessStoreError>;
}

export class McpHarnessStore extends Context.Service<McpHarnessStore, McpHarnessStoreShape>()(
  "t3/mcp/McpHarnessStore",
) {}

const makeMcpHarnessStore = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const userSkillRoot = path.join(config.stateDir, "skills");
  const artifactRoot = path.join(config.stateDir, "artifacts");
  const proposalRoot = path.join(config.stateDir, "skill-proposals");
  const memoryProposalRoot = path.join(config.stateDir, "memory-proposals");

  const fail = (operation: string, detail: string, cause?: unknown) =>
    Effect.fail(harnessError(operation, detail, cause));
  const withHarnessError = (operation: string, detail: string) =>
    Effect.mapError((cause: unknown) => harnessError(operation, detail, cause));
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const validateName = Effect.fn("McpHarnessStore.validateName")(function* (name: string) {
    const normalized = name.trim().replace(/\.md$/i, "");
    if (!slugPattern.test(normalized)) {
      return yield* fail("validate-skill-name", `Invalid managed skill name '${name}'.`);
    }
    return normalized;
  });

  const workspaceRootFor = (workspaceRoot: string | undefined): string =>
    path.resolve(workspaceRoot ?? config.cwd);

  const skillPath = (workspaceRoot: string | undefined, scope: "user" | "project", name: string) =>
    path.join(
      scope === "user"
        ? userSkillRoot
        : path.join(workspaceRootFor(workspaceRoot), ".t3", "skills"),
      name,
      "SKILL.md",
    );

  const readSkillFile = Effect.fn("McpHarnessStore.readSkillFile")(function* (
    filePath: string,
    scope: "user" | "project",
    name: string,
  ) {
    const body = yield* fileSystem
      .readFileString(filePath)
      .pipe(withHarnessError("read-skill", `Unable to read skill '${name}'.`));
    if (body.trim().length === 0) {
      return yield* fail("read-skill", `Managed skill '${name}' is empty.`);
    }
    const info = yield* fileSystem
      .stat(filePath)
      .pipe(withHarnessError("stat-skill", `Unable to stat skill '${name}'.`));
    const updatedAt =
      Option.match(info.mtime, {
        onNone: () => undefined,
        onSome: (value) => value.toISOString(),
      }) ?? (yield* nowIso);
    return {
      summary: { name, scope, managed: true, enabled: true, path: filePath },
      body,
      contentHash: yield* sha256Hex(crypto, body).pipe(
        withHarnessError("hash-skill", `Unable to hash skill '${name}'.`),
      ),
      updatedAt,
    } satisfies SkillDocument;
  });

  const listSkillScope = Effect.fn("McpHarnessStore.listSkillScope")(function* (
    root: string,
    scope: "user" | "project",
  ) {
    if (
      !(yield* fileSystem
        .exists(root)
        .pipe(withHarnessError("list-skills", `Unable to inspect '${root}'.`)))
    ) {
      return [];
    }
    const entries = yield* fileSystem
      .readDirectory(root)
      .pipe(withHarnessError("list-skills", `Unable to list managed skills in '${root}'.`));
    const result: Array<SkillSummary> = [];
    for (const name of entries) {
      if (!slugPattern.test(name)) continue;
      const filePath = path.join(root, name, "SKILL.md");
      if (
        !(yield* fileSystem
          .exists(filePath)
          .pipe(withHarnessError("list-skills", `Unable to inspect skill '${name}'.`)))
      ) {
        continue;
      }
      const info = yield* fileSystem
        .stat(filePath)
        .pipe(withHarnessError("stat-skill", `Unable to stat skill '${name}'.`));
      if (info.type === "File") {
        result.push({ name, scope, managed: true, enabled: true, path: filePath });
      }
    }
    return result;
  });

  const listSkills: McpHarnessStoreShape["listSkills"] = Effect.fn("McpHarnessStore.listSkills")(
    function* (input) {
      const roots: Array<ReadonlyArray<SkillSummary>> = [];
      if (input.scope === undefined || input.scope === "user") {
        roots.push(yield* listSkillScope(userSkillRoot, "user"));
      }
      if (input.scope === undefined || input.scope === "project") {
        roots.push(
          yield* listSkillScope(
            path.join(workspaceRootFor(input.workspaceRoot), ".t3", "skills"),
            "project",
          ),
        );
      }
      return roots.flat();
    },
  );

  const readSkill: McpHarnessStoreShape["readSkill"] = Effect.fn("McpHarnessStore.readSkill")(
    function* (input) {
      const name = yield* validateName(input.name);
      return yield* readSkillFile(
        skillPath(input.workspaceRoot, input.scope, name),
        input.scope,
        name,
      );
    },
  );

  const saveSkill: McpHarnessStoreShape["saveSkill"] = Effect.fn("McpHarnessStore.saveSkill")(
    function* (input) {
      const name = yield* validateName(input.name);
      const body = input.body.trim();
      if (!body || body.length > MAX_SKILL_BODY_CHARS || secretPattern.test(body)) {
        return yield* fail("save-skill", "Managed skill body was rejected by the content policy.");
      }
      const filePath = skillPath(input.workspaceRoot, input.scope, name);
      yield* fileSystem
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(withHarnessError("save-skill", `Unable to create skill '${name}'.`));
      yield* fileSystem
        .writeFileString(filePath, body.endsWith("\n") ? body : `${body}\n`)
        .pipe(withHarnessError("save-skill", `Unable to save skill '${name}'.`));
      return yield* readSkillFile(filePath, input.scope, name);
    },
  );

  const deleteSkill: McpHarnessStoreShape["deleteSkill"] = Effect.fn("McpHarnessStore.deleteSkill")(
    function* (input) {
      const name = yield* validateName(input.name);
      yield* fileSystem
        .remove(path.dirname(skillPath(input.workspaceRoot, input.scope, name)), {
          recursive: true,
        })
        .pipe(withHarnessError("delete-skill", `Unable to delete skill '${name}'.`));
    },
  );

  const createSkillProposal: McpHarnessStoreShape["createSkillProposal"] = Effect.fn(
    "McpHarnessStore.createSkillProposal",
  )(function* (input) {
    const name = yield* validateName(input.name);
    const body = input.body.trim();
    if (!body || body.length > MAX_SKILL_BODY_CHARS || secretPattern.test(body)) {
      return yield* fail(
        "create-skill-proposal",
        "Skill proposal was rejected by the content policy.",
      );
    }
    const now = yield* nowIso;
    const proposal = {
      id: yield* crypto.randomUUIDv4.pipe(
        withHarnessError("create-skill-proposal", "Unable to generate a skill proposal id."),
      ),
      name,
      scope: input.scope,
      body,
      reason: input.reason.trim(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    } satisfies SkillProposal;
    const encoded = yield* encodeSkillProposal(proposal).pipe(
      withHarnessError("encode-skill-proposal", "Unable to encode skill proposal."),
    );
    yield* fileSystem
      .makeDirectory(proposalRoot, { recursive: true })
      .pipe(withHarnessError("create-skill-proposal", "Unable to create the proposal directory."));
    yield* fileSystem
      .writeFileString(path.join(proposalRoot, `${proposal.id}.json`), `${encoded}\n`)
      .pipe(withHarnessError("create-skill-proposal", "Unable to persist skill proposal."));
    return proposal;
  });

  const projectIdForThread = Effect.fn("McpHarnessStore.projectIdForThread")(function* (
    threadId: ThreadId | undefined,
  ) {
    if (threadId === undefined) return undefined;
    const rows = yield* sql<{ readonly projectId: string }>`
      SELECT project_id AS "projectId"
      FROM projection_threads
      WHERE thread_id = ${threadId}
      LIMIT 1
    `.pipe(withHarnessError("resolve-project", "Unable to resolve the current project."));
    return rows[0]?.projectId as ProjectId | undefined;
  });

  const createMemoryProposal: McpHarnessStoreShape["createMemoryProposal"] = Effect.fn(
    "McpHarnessStore.createMemoryProposal",
  )(function* (input) {
    const key = input.key.trim();
    const value = input.value.trim();
    const reason = input.reason.trim();
    const projectId =
      input.scope === "project" ? yield* projectIdForThread(input.threadId) : undefined;
    const limit = input.scope === "project" ? MAX_MEMORY_VALUE_CHARS : USER_MEMORY_LIMIT;
    if (!key || !value || !reason || value.length > limit || secretPattern.test(value)) {
      return yield* fail(
        "create-memory-proposal",
        "Memory proposal was rejected by the content policy.",
      );
    }
    const now = yield* nowIso;
    const proposal = {
      id: yield* crypto.randomUUIDv4.pipe(
        withHarnessError("create-memory-proposal", "Unable to generate a memory proposal id."),
      ),
      scope: input.scope,
      ...(projectId === undefined ? {} : { projectId }),
      key,
      value,
      reason,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    } satisfies MemoryProposal;
    const encoded = yield* encodeMemoryProposal(proposal).pipe(
      withHarnessError("encode-memory-proposal", "Unable to encode memory proposal."),
    );
    yield* fileSystem
      .makeDirectory(memoryProposalRoot, { recursive: true })
      .pipe(withHarnessError("create-memory-proposal", "Unable to create the proposal directory."));
    yield* fileSystem
      .writeFileString(path.join(memoryProposalRoot, `${proposal.id}.json`), `${encoded}\n`)
      .pipe(withHarnessError("create-memory-proposal", "Unable to persist memory proposal."));
    return proposal;
  });

  type SearchRow = {
    readonly messageId: string;
    readonly threadId: string;
    readonly role: string;
    readonly snippet: string;
    readonly createdAt: string;
  };

  const searchSessionRows = Effect.fn("McpHarnessStore.searchSessionRows")(function* (input: {
    readonly query: string;
    readonly threadId?: ThreadId;
    readonly projectId?: ProjectId;
    readonly limit: number;
    readonly offset: number;
  }) {
    const rows =
      input.threadId !== undefined && input.projectId !== undefined
        ? sql<SearchRow>`SELECT search.message_id AS "messageId", search.thread_id AS "threadId",
          search.role AS role, snippet(projection_thread_message_search, 3, '[', ']', '…', 24) AS snippet,
          search.created_at AS "createdAt"
        FROM projection_thread_message_search AS search
        INNER JOIN projection_threads AS threads ON threads.thread_id = search.thread_id
        WHERE projection_thread_message_search MATCH ${input.query}
          AND threads.deleted_at IS NULL AND search.thread_id = ${input.threadId}
          AND threads.project_id = ${input.projectId}
        ORDER BY rank, search.created_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`
        : input.threadId !== undefined
          ? sql<SearchRow>`SELECT search.message_id AS "messageId", search.thread_id AS "threadId",
            search.role AS role, snippet(projection_thread_message_search, 3, '[', ']', '…', 24) AS snippet,
            search.created_at AS "createdAt"
          FROM projection_thread_message_search AS search
          INNER JOIN projection_threads AS threads ON threads.thread_id = search.thread_id
          WHERE projection_thread_message_search MATCH ${input.query}
            AND threads.deleted_at IS NULL AND search.thread_id = ${input.threadId}
          ORDER BY rank, search.created_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`
          : input.projectId !== undefined
            ? sql<SearchRow>`SELECT search.message_id AS "messageId", search.thread_id AS "threadId",
              search.role AS role, snippet(projection_thread_message_search, 3, '[', ']', '…', 24) AS snippet,
              search.created_at AS "createdAt"
            FROM projection_thread_message_search AS search
            INNER JOIN projection_threads AS threads ON threads.thread_id = search.thread_id
            WHERE projection_thread_message_search MATCH ${input.query}
              AND threads.deleted_at IS NULL AND threads.project_id = ${input.projectId}
            ORDER BY rank, search.created_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`
            : sql<SearchRow>`SELECT search.message_id AS "messageId", search.thread_id AS "threadId",
              search.role AS role, snippet(projection_thread_message_search, 3, '[', ']', '…', 24) AS snippet,
              search.created_at AS "createdAt"
            FROM projection_thread_message_search AS search
            INNER JOIN projection_threads AS threads ON threads.thread_id = search.thread_id
            WHERE projection_thread_message_search MATCH ${input.query}
              AND threads.deleted_at IS NULL
            ORDER BY rank, search.created_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`;
    return yield* rows.pipe(withHarnessError("search-sessions", "Session search failed."));
  });

  const searchSessions: McpHarnessStoreShape["searchSessions"] = Effect.fn(
    "McpHarnessStore.searchSessions",
  )(function* (input) {
    const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, input.limit ?? 10));
    const offset = input.cursor === undefined ? 0 : Math.max(0, Number(input.cursor) || 0);
    const projectId =
      input.scope === "project"
        ? (input.projectId ?? (yield* projectIdForThread(input.threadId)))
        : input.projectId;
    const matchQuery = input.query
      .trim()
      .split(/\s+/)
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" AND ");
    const rows = yield* searchSessionRows({
      query: matchQuery,
      ...(input.scope !== "project" && input.threadId !== undefined
        ? { threadId: input.threadId }
        : {}),
      ...(projectId === undefined ? {} : { projectId }),
      limit: limit + 1,
      offset,
    });
    return {
      results: rows.slice(0, limit).map(
        (row) =>
          ({
            messageId: row.messageId,
            threadId: row.threadId as ThreadId,
            role: row.role,
            snippet: (row.snippet.trim() || "[empty message]").slice(0, 600),
            createdAt: row.createdAt,
          }) satisfies SessionSearchResult,
      ),
      ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {}),
    };
  });

  const openSessionMessage: McpHarnessStoreShape["openSessionMessage"] = Effect.fn(
    "McpHarnessStore.openSessionMessage",
  )(function* (input) {
    const projectId =
      input.scope === "project" ? yield* projectIdForThread(input.threadId) : undefined;
    if (input.scope === "project" && projectId === undefined) {
      return yield* fail("open-session-message", "The current thread has no project scope.");
    }
    type SessionMessageRow = {
      readonly messageId: string;
      readonly threadId: string;
      readonly role: string;
      readonly text: string;
      readonly createdAt: string;
    };
    const rows =
      input.scope === "project"
        ? yield* sql<SessionMessageRow>`SELECT messages.message_id AS "messageId",
          messages.thread_id AS "threadId", messages.role AS role, messages.text AS text,
          messages.created_at AS "createdAt"
        FROM projection_thread_messages AS messages
        INNER JOIN projection_threads AS threads ON threads.thread_id = messages.thread_id
        WHERE messages.message_id = ${input.messageId}
          AND threads.deleted_at IS NULL AND threads.project_id = ${projectId!}
        LIMIT 1`.pipe(withHarnessError("open-session-message", "Session message lookup failed."))
        : yield* sql<SessionMessageRow>`SELECT messages.message_id AS "messageId",
          messages.thread_id AS "threadId", messages.role AS role, messages.text AS text,
          messages.created_at AS "createdAt"
        FROM projection_thread_messages AS messages
        INNER JOIN projection_threads AS threads ON threads.thread_id = messages.thread_id
        WHERE messages.message_id = ${input.messageId}
          AND threads.deleted_at IS NULL AND messages.thread_id = ${input.threadId}
        LIMIT 1`.pipe(withHarnessError("open-session-message", "Session message lookup failed."));
    const row = rows[0];
    if (!row) return yield* fail("open-session-message", "Session message was not found.");
    return {
      messageId: row.messageId,
      threadId: row.threadId as ThreadId,
      role: row.role,
      text: row.text,
      createdAt: row.createdAt,
    } satisfies SessionSearchMessage;
  });

  type MemoryRow = {
    readonly memoryId: string;
    readonly scope: "user" | "project";
    readonly projectId: string;
    readonly memoryKey: string;
    readonly memoryValue: string;
    readonly source: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };

  const memoryRows = Effect.fn("McpHarnessStore.memoryRows")(function* (projectId?: ProjectId) {
    const rows =
      projectId === undefined
        ? sql<MemoryRow>`SELECT memory_id AS "memoryId", scope,
          COALESCE(project_id, '') AS "projectId", memory_key AS "memoryKey",
          memory_value AS "memoryValue", source, created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM harness_memory
        WHERE scope = 'user' AND project_id = ''
        ORDER BY updated_at DESC`
        : sql<MemoryRow>`SELECT memory_id AS "memoryId", scope,
          COALESCE(project_id, '') AS "projectId", memory_key AS "memoryKey",
          memory_value AS "memoryValue", source, created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM harness_memory
        WHERE (scope = 'user' AND project_id = '')
           OR (scope = 'project' AND project_id = ${projectId})
        ORDER BY updated_at DESC`;
    return yield* rows.pipe(withHarnessError("list-memory", "Memory lookup failed."));
  });

  const decodeMemory = (row: MemoryRow): MemoryEntry => ({
    id: row.memoryId,
    scope: row.scope,
    ...(row.projectId ? { projectId: row.projectId as ProjectId } : {}),
    key: row.memoryKey,
    value: row.memoryValue,
    ...(row.source ? { source: row.source } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const listMemory: McpHarnessStoreShape["listMemory"] = Effect.fn("McpHarnessStore.listMemory")(
    function* (input) {
      const projectId = input.projectId ?? (yield* projectIdForThread(input.threadId));
      return (yield* memoryRows(projectId)).map(decodeMemory);
    },
  );

  const upsertMemory: McpHarnessStoreShape["upsertMemory"] = Effect.fn(
    "McpHarnessStore.upsertMemory",
  )(function* (input) {
    const key = input.key.trim();
    const value = input.value.trim();
    const projectId = input.projectId ?? (yield* projectIdForThread(input.threadId));
    const limit = projectId === undefined ? USER_MEMORY_LIMIT : MAX_MEMORY_VALUE_CHARS;
    if (!key || !value || value.length > limit || secretPattern.test(value)) {
      return yield* fail("upsert-memory", "Memory entry was rejected by the content policy.");
    }
    const scope = projectId === undefined ? "user" : "project";
    const projectKey = projectId ?? "";
    const now = yield* nowIso;
    const memoryId = yield* crypto.randomUUIDv4.pipe(
      withHarnessError("upsert-memory", "Unable to generate a memory entry id."),
    );
    yield* sql`
        INSERT INTO harness_memory(
          memory_id, scope, project_id, memory_key, memory_value, source, created_at, updated_at
        )
        VALUES (
          ${memoryId}, ${scope}, ${projectKey}, ${key}, ${value},
          ${input.source?.trim() ?? null}, ${now}, ${now}
        )
        ON CONFLICT(scope, project_id, memory_key) DO UPDATE SET
          memory_value = excluded.memory_value,
          source = excluded.source,
          updated_at = excluded.updated_at
      `.pipe(withHarnessError("upsert-memory", "Memory entry could not be persisted."));
    const rows = yield* sql<MemoryRow>`
        SELECT memory_id AS "memoryId", scope, COALESCE(project_id, '') AS "projectId",
          memory_key AS "memoryKey", memory_value AS "memoryValue", source,
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM harness_memory
        WHERE scope = ${scope} AND project_id = ${projectKey} AND memory_key = ${key}
        LIMIT 1
      `.pipe(withHarnessError("upsert-memory", "Memory entry could not be loaded."));
    const row = rows[0];
    if (!row) return yield* fail("upsert-memory", "Memory entry did not persist.");
    return decodeMemory(row);
  });

  const approveMemoryProposal: McpHarnessStoreShape["approveMemoryProposal"] = Effect.fn(
    "McpHarnessStore.approveMemoryProposal",
  )(function* (input) {
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) {
      return yield* fail("approve-memory-proposal", "Invalid memory proposal id.");
    }
    const proposalPath = path.join(memoryProposalRoot, `${input.id}.json`);
    const encoded = yield* fileSystem
      .readFileString(proposalPath)
      .pipe(withHarnessError("approve-memory-proposal", "Memory proposal was not found."));
    const proposal = yield* decodeMemoryProposal(encoded).pipe(
      withHarnessError("decode-memory-proposal", "Memory proposal is invalid."),
    );
    if (proposal.status !== "pending") {
      return yield* fail("approve-memory-proposal", "Memory proposal is no longer pending.");
    }
    const projectId =
      proposal.scope === "project" ? yield* projectIdForThread(input.threadId) : undefined;
    if (proposal.scope === "project" && projectId !== proposal.projectId) {
      return yield* fail(
        "approve-memory-proposal",
        "Memory proposal is outside the current project.",
      );
    }
    const entry = yield* upsertMemory({
      ...(projectId === undefined ? {} : { projectId }),
      key: proposal.key,
      value: proposal.value,
      source: `proposal:${proposal.id}`,
    });
    const approved = { ...proposal, status: "approved" as const, updatedAt: yield* nowIso };
    const approvedEncoded = yield* encodeMemoryProposal(approved).pipe(
      withHarnessError("encode-memory-proposal", "Memory proposal status could not be encoded."),
    );
    yield* fileSystem
      .writeFileString(proposalPath, `${approvedEncoded}\n`)
      .pipe(
        withHarnessError("approve-memory-proposal", "Memory proposal status could not be updated."),
      );
    return entry;
  });

  const deleteMemory: McpHarnessStoreShape["deleteMemory"] = Effect.fn(
    "McpHarnessStore.deleteMemory",
  )(function* (input) {
    const projectId = input.projectId ?? (yield* projectIdForThread(input.threadId));
    yield* sql`
        DELETE FROM harness_memory
        WHERE memory_key = ${input.key.trim()}
          AND scope = ${projectId === undefined ? "user" : "project"}
          AND project_id = ${projectId ?? ""}
      `.pipe(withHarnessError("delete-memory", "Memory entry could not be deleted."));
  });

  const putArtifact: McpHarnessStoreShape["putArtifact"] = Effect.fn("McpHarnessStore.putArtifact")(
    function* (input) {
      const bytes =
        typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content;
      if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
        return yield* fail("put-artifact", "Artifact exceeds the 2 MB limit.");
      }
      if (typeof input.content === "string" && secretPattern.test(input.content)) {
        return yield* fail(
          "put-artifact",
          "Artifact was rejected because it contains secret-like material.",
        );
      }
      const id = yield* crypto.randomUUIDv4.pipe(
        withHarnessError("put-artifact", "Unable to generate an artifact id."),
      );
      const artifactPath = path.join(artifactRoot, `${id}.bin`);
      const createdAt = yield* nowIso;
      const metadata = yield* encodeArtifactMetadata({
        threadId: input.threadId,
        source: input.source,
        createdAt,
      }).pipe(withHarnessError("encode-artifact-metadata", "Unable to encode artifact metadata."));
      yield* fileSystem
        .makeDirectory(artifactRoot, { recursive: true })
        .pipe(withHarnessError("put-artifact", "Unable to create the artifact directory."));
      yield* fileSystem
        .writeFile(artifactPath, bytes)
        .pipe(withHarnessError("put-artifact", "Unable to persist artifact."));
      yield* fileSystem
        .writeFileString(`${artifactPath}.meta`, `${metadata}\n`)
        .pipe(withHarnessError("put-artifact", "Unable to persist artifact metadata."));
      return {
        id,
        mediaType: input.mediaType ?? "text/plain",
        byteCount: bytes.byteLength,
        checksum: yield* sha256Hex(crypto, bytes).pipe(
          withHarnessError("hash-artifact", "Unable to hash artifact."),
        ),
        source: input.source,
      } satisfies ArtifactRef;
    },
  );

  const readArtifact: McpHarnessStoreShape["readArtifact"] = Effect.fn(
    "McpHarnessStore.readArtifact",
  )(function* (input) {
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) {
      return yield* fail("read-artifact", "Invalid artifact id.");
    }
    const artifactPath = path.join(artifactRoot, `${input.id}.bin`);
    const metadata = yield* fileSystem
      .readFileString(`${artifactPath}.meta`)
      .pipe(withHarnessError("read-artifact", "Artifact metadata was not found."));
    const parsed = yield* decodeArtifactMetadata(metadata).pipe(
      withHarnessError("decode-artifact-metadata", "Artifact metadata is invalid."),
    );
    if (parsed.threadId !== input.threadId) {
      return yield* fail("read-artifact", "Artifact does not belong to this thread.");
    }
    const bytes = yield* fileSystem
      .readFile(artifactPath)
      .pipe(withHarnessError("read-artifact", "Artifact was not found."));
    return bytes.subarray(
      Math.max(0, input.start ?? 0),
      Math.min(bytes.length, input.end ?? bytes.length),
    );
  });

  const runWorkflow: McpHarnessStoreShape["executeWorkflow"] = Effect.fn(
    "McpHarnessStore.runWorkflow",
  )(function* (input) {
    if (input.definition.operations.length > 20) {
      return yield* fail("execute-workflow", "Workflow contains more than 20 operations.");
    }
    const workspaceRoot = workspaceRootFor(input.workspaceRoot);
    const outputs = new Map<string, unknown>();
    for (const operation of input.definition.operations) {
      const operationInput = yield* Effect.try({
        try: () => resolveWorkflowReferences(operation.input, outputs) as Record<string, unknown>,
        catch: (cause) => harnessError("execute-workflow", "Invalid workflow reference.", cause),
      });
      let result: unknown;
      if (operation.kind === "session-search") {
        const query = typeof operationInput.query === "string" ? operationInput.query : "";
        if (!query) {
          return yield* fail(
            "execute-workflow",
            `Workflow operation '${operation.id}' requires query.`,
          );
        }
        result = yield* searchSessions({
          query,
          threadId: input.threadId,
          ...(typeof operationInput.limit === "number" ? { limit: operationInput.limit } : {}),
        });
      } else if (operation.kind === "artifact-slice") {
        const id = typeof operationInput.id === "string" ? operationInput.id : "";
        if (!id) {
          return yield* fail(
            "execute-workflow",
            `Workflow operation '${operation.id}' requires artifact id.`,
          );
        }
        const bytes = yield* readArtifact({
          threadId: input.threadId,
          id,
          ...(typeof operationInput.start === "number" ? { start: operationInput.start } : {}),
          ...(typeof operationInput.end === "number" ? { end: operationInput.end } : {}),
        });
        result = new TextDecoder().decode(bytes);
      } else {
        const target = typeof operationInput.path === "string" ? operationInput.path : ".";
        const absolute = path.resolve(workspaceRoot, target);
        const relativeTarget = path.relative(workspaceRoot, absolute);
        if (
          relativeTarget === ".." ||
          relativeTarget.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeTarget)
        ) {
          return yield* fail("execute-workflow", `Workflow path escapes the workspace: ${target}`);
        }
        if (operation.kind === "file-read") {
          const file = yield* workspaceFileSystem
            .readFile({ cwd: workspaceRoot, relativePath: relativeTarget || "." })
            .pipe(
              withHarnessError(
                "execute-workflow-file-read",
                `Workflow operation '${operation.id}' failed.`,
              ),
            );
          result = file.contents.slice(0, 32_000);
        } else {
          const query = typeof operationInput.query === "string" ? operationInput.query : "";
          if (!query) {
            return yield* fail(
              "execute-workflow",
              `Workflow operation '${operation.id}' requires query.`,
            );
          }
          const matches = yield* workspaceEntries
            .searchContents({
              cwd: absolute,
              query,
              limit: 200,
              caseSensitive: false,
              wholeWord: false,
              useRegex: false,
            })
            .pipe(
              withHarnessError(
                "execute-workflow-workspace-search",
                `Workflow operation '${operation.id}' failed.`,
              ),
            );
          result = matches.matches.map((match) => ({
            path: path.relative(workspaceRoot, path.join(absolute, match.path)),
            line: match.lineContent.slice(0, 500),
          }));
        }
      }
      outputs.set(operation.id, result);
    }
    if (!outputs.has(input.definition.output)) {
      return yield* fail(
        "execute-workflow",
        `Workflow output '${input.definition.output}' was not produced.`,
      );
    }
    const output = outputs.get(input.definition.output);
    const serialized =
      output === undefined
        ? undefined
        : yield* encodeUnknownJson(output).pipe(
            withHarnessError("encode-workflow-output", "Workflow output could not be encoded."),
          );
    const outputBytes =
      serialized === undefined ? 0 : new TextEncoder().encode(serialized).byteLength;
    if (outputBytes > 1_000_000) {
      return yield* fail("execute-workflow", "Workflow output exceeds the 1 MB limit.");
    }
    if (serialized !== undefined && outputBytes > 8_000) {
      const artifact = yield* putArtifact({
        threadId: input.threadId,
        source: "execute_workflow",
        content: serialized,
        mediaType: "application/json",
      });
      return {
        output: { preview: serialized.slice(0, 8_000), artifact },
        operationCount: input.definition.operations.length,
        artifact,
      } satisfies WorkflowResult;
    }
    return { output, operationCount: input.definition.operations.length } satisfies WorkflowResult;
  });

  const executeWorkflow: McpHarnessStoreShape["executeWorkflow"] = (input) =>
    runWorkflow(input).pipe(
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => fail("execute-workflow", "Workflow exceeded the 30 second limit."),
      }),
    );

  return {
    listSkills,
    readSkill,
    saveSkill,
    deleteSkill,
    createSkillProposal,
    createMemoryProposal,
    approveMemoryProposal,
    searchSessions,
    openSessionMessage,
    listMemory,
    upsertMemory,
    deleteMemory,
    putArtifact,
    readArtifact,
    executeWorkflow,
  } satisfies McpHarnessStoreShape;
});

export const McpHarnessStoreLive = Layer.effect(McpHarnessStore, makeMcpHarnessStore);
