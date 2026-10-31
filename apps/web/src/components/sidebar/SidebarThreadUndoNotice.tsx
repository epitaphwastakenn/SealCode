import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import {
  threadUndoLabel,
  threadUndoNoticeSummary,
  undoLatestThreadAction,
  useThreadUndoNotice,
} from "../../hooks/showThreadUndoNotice";
import { cn } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { InlineButton } from "../ui/button";

export function SidebarThreadUndoNotice({ className }: { className?: string }) {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const summary = notice ? threadUndoNoticeSummary(notice) : null;

  // Keeps the last text on screen while it fades out, then unmounts on transitionend.
  const [shownSummary, setShownSummary] = useState(summary);
  if (summary && summary !== shownSummary) setShownSummary(summary);
  const text = summary ?? shownSummary;
  if (!text) return null;

  return (
    <div
      role="group"
      aria-hidden={!summary}
      inert={!summary}
      onTransitionEnd={(event) => {
        if (!summary && event.target === event.currentTarget) setShownSummary(null);
      }}
      className={cn(
        "mb-1 flex w-fit max-w-full gap-1 rounded-lg bg-sidebar-control-surface px-2 text-xs leading-6 text-sidebar-muted-foreground backdrop-blur-sm transition-opacity duration-200 ease-out starting:opacity-0",
        !summary && "opacity-0",
        className,
      )}
    >
      <span className="min-w-0 truncate">{text},</span>
      <InlineButton onClick={undoLatestThreadAction}>{threadUndoLabel(keybindings)}</InlineButton>
    </div>
  );
}
