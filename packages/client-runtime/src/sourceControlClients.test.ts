import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "./sourceControlClients.ts";

const parse = (url: string) => {
  const parsed = sourceControlClients.parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const { repositoryUrl: _repositoryUrl, ...link } = parsed.link;
  return link;
};
const kindOf = (url: string) => sourceControlClients.parseChangeRequestUrl(url)?.definition.kind;

describe("sourceControlClients.parseChangeRequestUrl", () => {
  it("reads a GitHub pull request, lower-casing the repository", () => {
    expect(parse("https://github.com/T3Tools/T3Code/pull/123")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("reads a GitHub pull request on any host, so GitHub Enterprise works on its own name", () => {
    expect(parse("https://code.github.example.com/acme/web/pull/42")).toEqual({
      host: "code.github.example.com",
      repository: "acme/web",
      number: 42,
    });
    expect(kindOf("https://scm.example.test/acme/web/pull/42")).toBe("github");
    expect(
      sourceControlClients.changeRequestUrlFromReferenceAutolink(
        "https://code.github.example.com/acme/web/issues/42",
      ),
    ).toBe("https://code.github.example.com/acme/web/pull/42");
  });

  it("leaves the URLs of retired hosts unclaimed", () => {
    for (const link of [
      "https://gitlab.com/t3tools/platform/t3code/-/merge_requests/42",
      "https://bitbucket.org/workspace/repo/pull-requests/5",
      "https://dev.azure.com/acme/platform/_git/t3code/pullrequest/17",
      "https://acme.visualstudio.com/platform/_git/t3code/pullrequest/17",
      "https://github.internal/team/repo/pulls/7",
    ]) {
      expect(parse(link), link).toBeNull();
    }
  });

  it("survives trailing segments, a trailing slash and a query string", () => {
    expect(parse("https://github.com/t3tools/t3code/pull/123/files?w=1")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
    expect(parse("https://github.com/t3tools/t3code/pull/123/")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("claims nothing it cannot be sure of", () => {
    for (const link of [
      "https://github.com/t3tools/t3code/issues/123",
      "https://github.com/t3tools/t3code/commit/0a1b2c3",
      "https://github.com/t3tools/t3code",
      "https://github.com/t3tools/t3code/pull/abc",
      "https://blog.example.test/2026/updates/archive/pull/3",
      "https://scm.example.test/acme/web/pull/0",
      "https://scm.example.test/acme/web/pull/9007199254740992",
      "ftp://scm.example.test/acme/web/pull/123",
      "javascript:alert(1)//github.com/t3tools/t3code/pull/1",
      "not a url",
    ]) {
      expect(parse(link), link).toBeNull();
    }
  });
});

describe("sourceControlClients.isSameChangeRequest", () => {
  const linked = "https://github.com/pingdotgg/t3code/pull/42";

  it("matches the same pull request whatever its case or trailing path", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        linked,
        "https://github.com/PingDotGG/T3Code/pull/42/files",
      ),
    ).toBe(true);
  });

  it("tells pull requests of different repositories and numbers apart", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        linked,
        "https://github.com/pingdotgg/t3code/pull/43",
      ),
    ).toBe(false);
    expect(
      sourceControlClients.isSameChangeRequest(
        linked,
        "https://github.com/pingdotgg/other/pull/42",
      ),
    ).toBe(false);
  });
});

describe("change request URLs built from a parsed link", () => {
  const sibling = (url: string, number: number) => {
    const parsed = sourceControlClients.parseChangeRequestUrl(url)!;
    return parsed.definition.changeRequestUrl({
      host: parsed.link.host,
      repository: parsed.link.repository,
      number,
      webUrl: parsed.link.repositoryUrl,
    });
  };

  it("builds a canonical sibling of a pull request URL", () => {
    expect(sibling("https://github.com/pull/1/pull/42/files", 43)).toBe(
      "https://github.com/pull/1/pull/43",
    );
  });
});

describe("sourceControlClients.recognizeRemote", () => {
  const kindOfRemote = (url: string) => sourceControlClients.recognizeRemote(url)?.kind ?? null;

  it("recognizes a GitHub remote by its host label and no other host", () => {
    expect(kindOfRemote("https://gitlab.github.example/o/r")).toBe("github");
    expect(kindOfRemote("git@github.com:pingdotgg/t3code.git")).toBe("github");
    expect(kindOfRemote("https://gitlab.example/o/r")).toBe("unknown");
    expect(kindOfRemote("https://bitbucket.org/o/r")).toBe("unknown");
    expect(kindOfRemote("git@git.cafe:pingdotgg/t3code.git")).toBe("unknown");
  });

  it("reads a remote no host claims as an unknown host, and a local path as no host", () => {
    expect(
      sourceControlClients.recognizeRemote("https://self-hosted.example.test:8443/group/repo.git"),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
    expect(sourceControlClients.recognizeRemote("git@github-work:owner/repo.git")).toEqual({
      kind: "unknown",
      name: "github-work",
      baseUrl: "https://github-work",
    });
    for (const local of ["/srv/git/repo.git", "C:/repos/project", "file:///srv/git/repo.git", ""]) {
      expect(sourceControlClients.recognizeRemote(local), local).toBeNull();
    }
  });
});

describe("sourceControlClients repository keys", () => {
  // Persisted as `repositoryIdentity.canonicalKey` and in thread pull request keys.
  it.each([
    ["git@github.com:T3Tools/T3Code.git", "github.com/t3tools/t3code"],
    ["ssh://git@git.company.test:2222/team/project.git", "git.company.test/team/project"],
    ["C:/repos/project", "c:/repos/project"],
  ])("keys %s as %s", (remote, key) => {
    expect(sourceControlClients.repositoryKeyFromRemote(remote)).toBe(key);
  });

  it("leaves keys of retired hosts as they are", () => {
    expect(sourceControlClients.canonicalRepositoryKey("org.visualstudio.com/p/_git/repo")).toBe(
      "org.visualstudio.com/p/_git/repo",
    );
    expect(sourceControlClients.findByRepositoryKey("dev.azure.com/o/r")).toBeUndefined();
    expect(sourceControlClients.findByRepositoryKey("github.com/o/r")).toBeUndefined();
  });
});

describe("sourceControlClients project hosts", () => {
  const identity = {
    canonicalKey: "forge.example/team/repo",
    locator: { remoteUrl: "http://forge.example:3000/team/repo.git" },
  };

  it("names the host of a project's remote, and falls back to the kind without a key", () => {
    expect(sourceControlClients.changeRequestHost(identity, "github")).toBe("forge.example");
    expect(sourceControlClients.changeRequestHost(identity, undefined)).toBe("forge.example");
    expect(
      sourceControlClients.changeRequestHost(
        { locator: { remoteUrl: "https://x.example/a/b" } },
        "github",
      ),
    ).toBe("github");
  });

  it("selects a repository by its path", () => {
    const repository = {
      displayName: "group/subgroup/service",
      owner: "group",
      name: "service",
    };
    expect(sourceControlClients.repositorySelector(repository)).toBe("group/subgroup/service");
    expect(
      sourceControlClients.repositorySelector({
        ...repository,
        provider: SourceControlProviderKind.make("github"),
      }),
    ).toBe("group/subgroup/service");
    expect(sourceControlClients.repositorySelector({ owner: "o", name: "r" })).toBe("o/r");
  });
});

describe("sourceControlClients.findByPublicDomain", () => {
  it("names the host a link is on, subdomains included", () => {
    const kindOf = (hostname: string) => sourceControlClients.findByPublicDomain(hostname)?.kind;
    expect(kindOf("gist.github.com")).toBe("github");
    expect(kindOf("gitlab.com")).toBeUndefined();
    expect(kindOf("notgithub.com")).toBeUndefined();
    expect(kindOf("github.com.example")).toBeUndefined();
  });

  it("leaves findByPublicHost to the public host alone", () => {
    expect(sourceControlClients.findByPublicHost("gist.github.com")).toBeUndefined();
  });
});
