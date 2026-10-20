import { describe, expect, it } from "vite-plus/test";

import { changelogReleases, parseChangelog, unseenReleases } from "./changelog";

const sample = `# What's new

<!--
## 9.9.9 · ignored
-->

## 1.2.0 · 2026-10-20

> Headline two.

### New

- **Card title** — card text
- plain item

### Fixed

- **Bug** - fixed text

## 1.1.0 · 2026-10-18

> Headline one.

### Improved

- **Faster** — less work
`;

describe("changelog", () => {
  it("parses releases, sections and titled items", () => {
    const releases = parseChangelog(sample);
    expect(releases.map((release) => release.version)).toEqual(["1.2.0", "1.1.0"]);
    expect(releases[0]).toEqual({
      version: "1.2.0",
      date: "2026-10-20",
      headline: "Headline two.",
      sections: [
        {
          section: "new",
          items: [
            { title: "Card title", text: "card text" },
            { title: null, text: "plain item" },
          ],
        },
        { section: "fixed", items: [{ title: "Bug", text: "fixed text" }] },
      ],
    });
  });

  it("shows every release since the last one seen, up to the running version", () => {
    const releases = parseChangelog(sample);
    const versions = (current: string, lastSeen: string | null) =>
      unseenReleases(releases, current, lastSeen).map((release) => release.version);
    expect(versions("1.2.0", "1.0.0")).toEqual(["1.2.0", "1.1.0"]);
    expect(versions("1.2.0", "1.1.0")).toEqual(["1.2.0"]);
    expect(versions("1.2.0", "1.2.0")).toEqual([]);
    expect(versions("1.1.0", "1.0.0")).toEqual(["1.1.0"]);
    expect(versions("1.2.0", null)).toEqual(["1.2.0"]);
    expect(versions("0.1.0", null)).toEqual([]);
  });

  it("bundles a well-formed CHANGELOG.md", () => {
    expect(changelogReleases.length).toBeGreaterThan(0);
    for (const release of changelogReleases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.headline).not.toBe("");
      expect(release.sections.length).toBeGreaterThan(0);
    }
  });
});
