import { compareSemverVersions } from "@t3tools/shared/semver";

import source from "../../../CHANGELOG.md?raw";

export type ChangelogSection = "new" | "improved" | "fixed";

export interface ChangelogItem {
  readonly title: string | null;
  readonly text: string;
}

export interface ChangelogRelease {
  readonly version: string;
  readonly date: string;
  readonly headline: string;
  readonly sections: ReadonlyArray<{
    readonly section: ChangelogSection;
    readonly items: ReadonlyArray<ChangelogItem>;
  }>;
}

const SECTION_NAMES: Readonly<Record<string, ChangelogSection>> = {
  new: "new",
  improved: "improved",
  fixed: "fixed",
};

function parseItem(line: string): ChangelogItem {
  const titled = /^\*\*(.+?)\*\*\s*[—–:-]?\s*(.*)$/.exec(line);
  return titled
    ? { title: titled[1]!.trim(), text: titled[2]!.trim() }
    : { title: null, text: line };
}

/** Reads CHANGELOG.md; the format is described in the file's header comment. */
export function parseChangelog(text: string): ReadonlyArray<ChangelogRelease> {
  type Mutable = {
    version: string;
    date: string;
    headline: string;
    sections: { section: ChangelogSection; items: ChangelogItem[] }[];
  };
  const releases: Mutable[] = [];
  for (const raw of text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      const [version = "", date = ""] = line
        .slice(3)
        .split("·")
        .map((part) => part.trim());
      releases.push({ version, date, headline: "", sections: [] });
      continue;
    }
    const release = releases.at(-1);
    if (!release) continue;
    if (line.startsWith("> ")) {
      release.headline = line.slice(2).trim();
    } else if (line.startsWith("### ")) {
      const section = SECTION_NAMES[line.slice(4).trim().toLowerCase()];
      if (section) release.sections.push({ section, items: [] });
    } else if (line.startsWith("- ")) {
      release.sections.at(-1)?.items.push(parseItem(line.slice(2).trim()));
    }
  }
  return releases;
}

export const changelogReleases = parseChangelog(source);

/**
 * What to show after launching `currentVersion`: every release since the one this
 * device last saw. A device that never recorded one (a fresh install, or an update
 * from before What's New existed) sees only the running version's notes.
 */
export function unseenReleases(
  releases: ReadonlyArray<ChangelogRelease>,
  currentVersion: string,
  lastSeenVersion: string | null,
): ReadonlyArray<ChangelogRelease> {
  if (lastSeenVersion === null) {
    return releases.filter((release) => release.version === currentVersion);
  }
  return releases.filter(
    (release) =>
      compareSemverVersions(release.version, lastSeenVersion) > 0 &&
      compareSemverVersions(release.version, currentVersion) <= 0,
  );
}
