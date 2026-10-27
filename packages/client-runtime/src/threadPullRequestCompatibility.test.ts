import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import {
  planThreadPullRequestMutation,
  threadPullRequestLinkMode,
} from "./threadPullRequestCompatibility.ts";

const reference = {
  host: "github.example",
  repository: "team/repo",
  number: 7,
  url: "https://github.example/team/repo/pull/7",
};
const input = {
  threadId: ThreadId.make("thread"),
  reference,
  legacyProjectId: ProjectId.make("exact-checkout"),
  linked: true,
};

describe("thread pull request capability negotiation", () => {
  it.each([undefined, {}, { threadPullRequests: false, threadPullRequestLinking: false }])(
    "does not dispatch when linking is unadvertised: %j",
    (capabilities) => {
      expect(threadPullRequestLinkMode(capabilities)).toBe("unsupported");
      expect(planThreadPullRequestMutation({ ...input, capabilities })).toBeNull();
    },
  );
  it("uses metadata updates for old single-link servers, including unlink", () => {
    const capabilities = { threadPullRequestLinking: true };
    expect(planThreadPullRequestMutation({ ...input, capabilities })).toEqual({
      type: "thread.meta.update",
      input: {
        threadId: input.threadId,
        linkedPullRequest: {
          projectId: input.legacyProjectId,
          repository: reference.repository,
          number: 7,
          url: reference.url,
        },
      },
    });
    expect(
      planThreadPullRequestMutation({
        ...input,
        capabilities,
        linked: false,
        legacyProjectId: null,
      }),
    ).toEqual({
      type: "thread.meta.update",
      input: { threadId: input.threadId, linkedPullRequest: null },
    });
  });
  it("uses the checkout's selector only for legacy metadata commands", () => {
    const selected = { ...input, legacyRepository: "repo" };
    expect(
      planThreadPullRequestMutation({
        ...selected,
        capabilities: { threadPullRequestLinking: true },
      }),
    ).toMatchObject({
      type: "thread.meta.update",
      input: { linkedPullRequest: { repository: "repo", number: 7 } },
    });
    expect(
      planThreadPullRequestMutation({
        ...selected,
        capabilities: { threadPullRequests: true },
      }),
    ).toMatchObject({
      type: "thread.pull-request.link",
      input: { repository: "team/repo", number: 7 },
    });
  });

  it("never sends a same-host route as an exact repository to an old server", () => {
    expect(
      planThreadPullRequestMutation({
        ...input,
        capabilities: { threadPullRequestLinking: true },
        legacyProjectId: null,
      }),
    ).toBeNull();
  });
  it.each([
    { threadPullRequests: true },
    { threadPullRequests: true, threadPullRequestLinking: true },
  ])("prefers multi-link commands when available: %j", (capabilities) => {
    expect(
      planThreadPullRequestMutation({ ...input, capabilities, legacyProjectId: null }),
    ).toEqual({
      type: "thread.pull-request.link",
      input: { threadId: input.threadId, ...reference, source: "manual" },
    });
    expect(planThreadPullRequestMutation({ ...input, capabilities, linked: false })).toEqual({
      type: "thread.pull-request.unlink",
      input: {
        threadId: input.threadId,
        host: reference.host,
        repository: reference.repository,
        number: reference.number,
      },
    });
  });
});
