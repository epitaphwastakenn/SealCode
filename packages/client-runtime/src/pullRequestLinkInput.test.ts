import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "./sourceControlClients.ts";

import { parsePullRequestReference, resolveLinkPullRequestInput } from "./pullRequestLinkInput.ts";

const changeRequestWebUrl = (kind: string, host: string, repository: string, number: number) =>
  sourceControlClients.get(kind).changeRequestUrl({ host, repository, number });

const project = {
  host: "github.com",
  repository: "acme/web",
  terminology: sourceControlClients.get("github").changeRequest,
  webUrl: (number: number) => changeRequestWebUrl("github", "github.com", "acme/web", number),
};

describe("resolveLinkPullRequestInput", () => {
  it("links a supported host URL without a thread project", () => {
    const url = "https://github.acme.test/acme/web/pull/42";
    expect(
      resolveLinkPullRequestInput({
        reference: ` ${url} `,
        project: null,
        hasProject: (candidate) => candidate.host === "github.acme.test",
      }),
    ).toEqual({
      link: { host: "github.acme.test", repository: "acme/web", number: 42, url },
    });
  });

  it("resolves a bare number against the thread's own repository", () => {
    expect(
      resolveLinkPullRequestInput({ reference: "#42", project, hasProject: () => true }),
    ).toEqual({
      link: {
        host: "github.com",
        repository: "acme/web",
        number: 42,
        url: "https://github.com/acme/web/pull/42",
      },
    });
  });

  it("names the project host's change request when it has no URL for a number", () => {
    expect(
      resolveLinkPullRequestInput({
        reference: "#42",
        project: {
          ...project,
          terminology: sourceControlClients.get("unknown").changeRequest,
          webUrl: () => null,
        },
        hasProject: () => true,
      }),
    ).toEqual({
      error: "Paste a full URL; this project's host has no known change request URL.",
    });
  });

  it("links a URL from another repository on a host with a project", () => {
    expect(
      resolveLinkPullRequestInput({
        reference: "https://github.com/acme/api/pull/7",
        project,
        hasProject: (reference) => reference.host === "github.com",
      }),
    ).toEqual({
      link: {
        host: "github.com",
        repository: "acme/api",
        number: 7,
        url: "https://github.com/acme/api/pull/7",
      },
    });
  });

  it("refuses a URL on a host nothing is checked out from", () => {
    const result = resolveLinkPullRequestInput({
      reference: "https://github.acme.test/acme/api/pull/7",
      project,
      hasProject: () => false,
    });
    expect(result).toMatchObject({ error: expect.stringContaining("github.acme.test") });
  });
});

describe("parsePullRequestReference", () => {
  it("accepts gh pr checkout commands with raw numbers", () => {
    expect(parsePullRequestReference("gh pr checkout 42")).toBe("42");
  });

  it("does not read the checkout commands of retired hosts", () => {
    expect(parsePullRequestReference("glab mr checkout 42")).toBeNull();
    expect(parsePullRequestReference("az repos pr checkout --id=42")).toBeNull();
  });

  it("rejects non-pull-request input", () => {
    expect(parsePullRequestReference("feature/my-branch")).toBeNull();
  });
});
