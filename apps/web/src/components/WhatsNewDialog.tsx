import { SparklesIcon, WrenchIcon, ZapIcon, type LucideIcon } from "lucide-react";
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
import { Button } from "./ui/button";
import { Dialog, DialogFooter, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";

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

const SECTION_STYLE: Readonly<
  Record<ChangelogSection, { label: string; icon: LucideIcon; tone: string; card: string }>
> = {
  new: {
    label: "New",
    icon: SparklesIcon,
    tone: "text-primary",
    card: "border-primary/25 bg-primary/6",
  },
  improved: {
    label: "Improved",
    icon: ZapIcon,
    tone: "text-info",
    card: "border-info/25 bg-info/6",
  },
  fixed: {
    label: "Fixed",
    icon: WrenchIcon,
    tone: "text-success",
    card: "border-success/25 bg-success/6",
  },
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
      <DialogPopup className="sm:max-w-xl">
        <header className="relative shrink-0 overflow-hidden rounded-t-2xl bg-linear-to-br from-primary/35 via-primary/15 to-transparent px-6 pt-6 pb-5">
          <div className="flex items-center gap-4 pe-8">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-background/40 shadow-sm">
              <img src="/sealcode-icon.png" alt="" className="size-10 object-contain" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>What's new</DialogTitle>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                  v{latest.version}
                </span>
              </div>
              {latest.headline ? (
                <p className="mt-1.5 text-sm text-foreground/90">{latest.headline}</p>
              ) : null}
              {latest.date ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{latest.date}</p>
              ) : null}
            </div>
          </div>
        </header>
        <DialogPanel>
          <div className="flex flex-col gap-6">
            {releases.map((release, index) => (
              <ReleaseNotes key={release.version} release={release} first={index === 0} />
            ))}
          </div>
        </DialogPanel>
        <DialogFooter className="items-center">
          <p className="me-auto text-xs text-muted-foreground max-sm:text-center">
            Open it again from Settings → General.
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
          <div className="flex items-center gap-3 text-xs font-semibold text-muted-foreground">
            <span className="h-px flex-1 bg-border" />v{release.version}
            {release.date ? ` · ${release.date}` : ""}
            <span className="h-px flex-1 bg-border" />
          </div>
          {release.headline ? <p className="text-sm font-medium">{release.headline}</p> : null}
        </div>
      )}
      {release.sections.map(({ section, items }, index) => {
        const style = SECTION_STYLE[section];
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a release may repeat a section heading
          <div key={index} className="space-y-2">
            <div
              className={`flex items-center gap-2 text-2xs font-semibold tracking-wide uppercase ${style.tone}`}
            >
              {style.label}
              <span className="h-px flex-1 bg-current opacity-25" />
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
  const style = SECTION_STYLE[section];
  if (section === "new" && item.title) {
    const Icon = style.icon;
    return (
      <li className={`flex gap-3 rounded-xl border p-3 ${style.card}`}>
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg bg-current/10 ${style.tone}`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.text}</p>
        </div>
      </li>
    );
  }
  return (
    <li className="flex gap-2.5 text-sm">
      <span className={`mt-2 size-1.5 shrink-0 rounded-full bg-current ${style.tone}`} />
      <div className="min-w-0">
        {item.title ? <span className="font-medium">{item.title}. </span> : null}
        <span className={item.title ? "text-muted-foreground" : undefined}>{item.text}</span>
      </div>
    </li>
  );
}
