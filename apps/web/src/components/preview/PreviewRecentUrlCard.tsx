import type { ScopedThreadRef } from "@t3tools/contracts";
import { X } from "lucide-react";

import { isValidHistoryTimestamp, type BrowserHistoryEntry } from "~/browserHistoryStore";
import { RelativeTime } from "~/components/RelativeTime";
import { Button } from "~/components/ui/button";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";

interface Props {
  threadRef: ScopedThreadRef;
  entry: BrowserHistoryEntry;
  onOpen: () => void;
  onRemove: () => void;
}

export function PreviewRecentUrlCard({ threadRef, entry, onOpen, onRemove }: Props) {
  const parsed = new URL(entry.url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const label = `${parsed.host}${path}${parsed.search}${parsed.hash}`;
  const visitedAt = isValidHistoryTimestamp(entry.lastVisitedAt) ? (
    <RelativeTime timestamp={new Date(entry.lastVisitedAt).toISOString()} />
  ) : null;
  return (
    <div className="group relative flex w-full items-center">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-3 py-3 pr-10 text-left hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <PreviewFaviconIcon threadRef={threadRef} url={entry.url} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {entry.title ?? label}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {entry.title ? `${label} · ` : ""}
            {visitedAt}
          </span>
        </div>
      </button>
      <span className="absolute right-3 flex opacity-0 focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
        <Button
          variant="ghost-muted"
          size="icon-micro"
          aria-label={`Remove ${label} from history`}
          onClick={onRemove}
        >
          <X />
        </Button>
      </span>
    </div>
  );
}
