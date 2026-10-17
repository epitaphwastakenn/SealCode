import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  lastOpenThreadRouteMatchesDraft,
  lastOpenThreadRouteMatchesServerThread,
  resolveChatIndexLanding,
} from "./chatIndexLanding";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function thread(overrides: {
  id: string;
  archivedAt?: string | null;
  updatedAt: string;
  createdAt?: string;
}) {
  return {
    environmentId: ENVIRONMENT_ID,
    id: ThreadId.make(overrides.id),
    archivedAt: overrides.archivedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-09T10:00:00.000Z",
    updatedAt: overrides.updatedAt,
    latestUserMessageAt: overrides.updatedAt,
  };
}

describe("resolveChatIndexLanding", () => {
  it("restores the last open server thread when it still exists", () => {
    expect(
      resolveChatIndexLanding({
        lastOpenThreadRoute: {
          kind: "server",
          environmentId: ENVIRONMENT_ID,
          threadId: "thread-old",
        },
        threads: [
          thread({ id: "thread-old", updatedAt: "2026-03-09T10:00:00.000Z" }),
          thread({ id: "thread-new", updatedAt: "2026-03-09T12:00:00.000Z" }),
        ],
        draftIds: new Set(),
        mostRecentProject: { environmentId: ENVIRONMENT_ID, id: PROJECT_ID },
      }),
    ).toEqual({
      kind: "server",
      environmentId: ENVIRONMENT_ID,
      threadId: ThreadId.make("thread-old"),
    });
  });

  it("restores a persisted draft when the server thread is gone", () => {
    expect(
      resolveChatIndexLanding({
        lastOpenThreadRoute: { kind: "draft", draftId: "draft-1" },
        threads: [],
        draftIds: new Set(["draft-1"]),
        mostRecentProject: { environmentId: ENVIRONMENT_ID, id: PROJECT_ID },
      }),
    ).toEqual({ kind: "draft", draftId: "draft-1" });
  });

  it("falls back to the most recently updated open thread", () => {
    expect(
      resolveChatIndexLanding({
        lastOpenThreadRoute: {
          kind: "server",
          environmentId: ENVIRONMENT_ID,
          threadId: "thread-missing",
        },
        threads: [
          thread({ id: "thread-old", updatedAt: "2026-03-09T10:00:00.000Z" }),
          thread({
            id: "thread-archived",
            updatedAt: "2026-03-09T13:00:00.000Z",
            archivedAt: "2026-03-10T00:00:00.000Z",
          }),
          thread({ id: "thread-new", updatedAt: "2026-03-09T12:00:00.000Z" }),
        ],
        draftIds: new Set(),
        mostRecentProject: { environmentId: ENVIRONMENT_ID, id: PROJECT_ID },
      }),
    ).toEqual({
      kind: "server",
      environmentId: ENVIRONMENT_ID,
      threadId: ThreadId.make("thread-new"),
    });
  });

  it("opens a new draft for the most recent project when no threads exist", () => {
    expect(
      resolveChatIndexLanding({
        lastOpenThreadRoute: null,
        threads: [],
        draftIds: new Set(),
        mostRecentProject: { environmentId: ENVIRONMENT_ID, id: PROJECT_ID },
      }),
    ).toEqual({
      kind: "new-draft",
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
    });
  });

  it("starts a scratch chat when there is no project yet", () => {
    expect(
      resolveChatIndexLanding({
        lastOpenThreadRoute: null,
        threads: [],
        draftIds: new Set(),
        mostRecentProject: null,
      }),
    ).toEqual({ kind: "scratch" });
  });
});

describe("lastOpenThreadRoute matching", () => {
  it("matches server and draft last-open routes", () => {
    expect(
      lastOpenThreadRouteMatchesServerThread(
        {
          kind: "server",
          environmentId: ENVIRONMENT_ID,
          threadId: "thread-1",
        },
        ENVIRONMENT_ID,
        "thread-1",
      ),
    ).toBe(true);
    expect(
      lastOpenThreadRouteMatchesServerThread(
        {
          kind: "server",
          environmentId: ENVIRONMENT_ID,
          threadId: "thread-1",
        },
        ENVIRONMENT_ID,
        "thread-2",
      ),
    ).toBe(false);
    expect(lastOpenThreadRouteMatchesDraft({ kind: "draft", draftId: "draft-1" }, "draft-1")).toBe(
      true,
    );
    expect(lastOpenThreadRouteMatchesDraft({ kind: "draft", draftId: "draft-1" }, "draft-2")).toBe(
      false,
    );
  });
});
