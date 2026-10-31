import { useEffect } from "react";
import { create } from "zustand";

import { APP_VERSION } from "~/branding";
import {
  changelogReleases,
  unseenReleases,
  type ChangelogItem,
  type ChangelogRelease,
  type ChangelogSection,
} from "~/changelog";
import { isElectron } from "~/env";
import {
  getClientSettings,
  persistClientSettingsPatch,
  useClientSettingsHydrated,
} from "~/hooks/useSettings";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import { HarpMark } from "./HarpMark";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { StatusDot, type StatusDotTone } from "./ui/status-dot";

const useWhatsNew = create<{ releases: ReadonlyArray<ChangelogRelease> | null }>(() => ({
  releases: null,
}));

/** Opens What's New on `releases`, or on the whole changelog. */
export function openWhatsNew(releases: ReadonlyArray<ChangelogRelease> = changelogReleases): void {
  if (releases.length > 0) useWhatsNew.setState({ releases });
}

function closeWhatsNew(): void {
  useWhatsNew.setState({ releases: null });
}

let launchChecked = false;

/** Opens What's New once after launching a version this device has not shown yet. */
function useOpenAfterUpdate(): void {
  const hydrated = useClientSettingsHydrated();
  // The desktop shell knows the installed version; the web bundle's own may be a dev default.
  const desktopVersion = useDesktopUpdateState()?.currentVersion;
  const version = isElectron ? desktopVersion : APP_VERSION;
  useEffect(() => {
    if (!hydrated || !version || launchChecked) return;
    launchChecked = true;
    const lastSeen = getClientSettings().lastSeenChangelogVersion;
    openWhatsNew(unseenReleases(changelogReleases, version, lastSeen));
    if (lastSeen !== version)
      void persistClientSettingsPatch({ lastSeenChangelogVersion: version });
  }, [hydrated, version]);
}

export function WhatsNewHost() {
  useOpenAfterUpdate();
  const releases = useWhatsNew((state) => state.releases);
  return releases ? <WhatsNewDialog releases={releases} /> : null;
}

const sectionStyles: Readonly<Record<ChangelogSection, { label: string; tone: StatusDotTone }>> = {
  new: { label: "New", tone: "brand" },
  improved: { label: "Improved", tone: "muted" },
  fixed: { label: "Fixed", tone: "muted" },
};

function WhatsNewDialog({ releases }: { readonly releases: ReadonlyArray<ChangelogRelease> }) {
  const [latest] = releases;
  if (!latest) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeWhatsNew();
      }}
    >
      <DialogPopup size="lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <HarpMark />
            <Badge variant="brand" size="sm">
              v{latest.version}
            </Badge>
          </div>
          <DialogTitle>What's new</DialogTitle>
          {latest.headline ? <DialogDescription>{latest.headline}</DialogDescription> : null}
          {latest.date ? <p className="text-xs text-muted-foreground">{latest.date}</p> : null}
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-6">
            {releases.map((release, index) => (
              <ReleaseNotes key={release.version} release={release} first={index === 0} />
            ))}
          </div>
        </DialogPanel>
        <DialogFooter className="items-center">
          <p className="me-auto text-xs text-muted-foreground max-sm:text-center">
            Open it again from General settings.
          </p>
          <Button onClick={closeWhatsNew}>Got it</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ReleaseNotes({
  release,
  first,
}: {
  readonly release: ChangelogRelease;
  readonly first: boolean;
}) {
  return (
    <section className="space-y-4">
      {first ? null : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
            <span className="h-px flex-1 bg-border/50" />v{release.version}
            {release.date ? ` · ${release.date}` : ""}
            <span className="h-px flex-1 bg-border/50" />
          </div>
          {release.headline ? <p className="text-sm font-medium">{release.headline}</p> : null}
        </div>
      )}
      {release.sections.map(({ section, items }, index) => {
        const style = sectionStyles[section];
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a release may repeat a section heading
          <div key={index} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <StatusDot tone={style.tone} />
              {style.label}
            </div>
            <ul className="space-y-2">
              {items.map((item, itemIndex) => (
                // oxlint-disable-next-line react/no-array-index-key -- items have no identity beyond their position
                <ChangelogEntry key={itemIndex} item={item} section={section} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function ChangelogEntry({
  item,
  section,
}: {
  readonly item: ChangelogItem;
  readonly section: ChangelogSection;
}) {
  if (section === "new" && item.title) {
    return (
      <li className="rounded-lg border border-border/50 bg-foreground/[0.03] p-3">
        <p className="text-sm font-medium">{item.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{item.text}</p>
      </li>
    );
  }
  return (
    <li className="text-sm">
      {item.title ? <span className="font-medium">{item.title}. </span> : null}
      <span className={item.title ? "text-muted-foreground" : undefined}>{item.text}</span>
    </li>
  );
}
