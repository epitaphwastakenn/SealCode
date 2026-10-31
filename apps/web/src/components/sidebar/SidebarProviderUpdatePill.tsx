import { Spinner } from "~/components/ui/spinner";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import { CircleCheckIcon, DownloadIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type CSSProperties } from "react";

import { primaryServerProvidersAtom } from "../../state/server";
import {
  getProviderUpdateSidebarPillView,
  type ProviderUpdateSidebarPillView,
} from "../ProviderUpdateLaunchNotification.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Matches the pill's `duration-180` class.
const PROVIDER_UPDATE_PILL_EXIT_MS = 180;

const PROVIDER_UPDATE_PILL_STYLES = {
  loading:
    "border border-transparent bg-sidebar-control-surface text-sidebar-foreground group-has-[button[data-provider-update-main]:hover]/provider-update:bg-sidebar-row-hover",
  success:
    "border border-transparent bg-sidebar-control-surface text-sidebar-foreground group-has-[button[data-provider-update-main]:hover]/provider-update:bg-sidebar-row-hover",
  warning:
    "border border-warning/32 bg-warning-surface text-warning-foreground group-has-[button[data-provider-update-main]:hover]/provider-update:bg-warning/16",
  error:
    "border border-error/32 bg-error-surface text-error-foreground group-has-[button[data-provider-update-main]:hover]/provider-update:bg-error/16",
} as const;

const PROVIDER_UPDATE_PILL_PROGRESS_STYLES = {
  success: "bg-foreground/8",
  warning: "bg-warning/14",
  error: "bg-error/14",
} as const;

function latestProviderCheckedAt(
  providers: ReadonlyArray<Pick<ServerProvider, "checkedAt">>,
): string | undefined {
  return providers.reduce<string | undefined>(
    (latest, provider) =>
      latest === undefined || provider.checkedAt > latest ? provider.checkedAt : latest,
    undefined,
  );
}

export function SidebarProviderUpdatePill() {
  const navigate = useNavigate();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [renderedView, setRenderedView] = useState<ProviderUpdateSidebarPillView | null>(null);
  const [pendingView, setPendingView] = useState<ProviderUpdateSidebarPillView | null>(null);
  const [exitingKey, setExitingKey] = useState<string | null>(null);
  const [dismissAfterExitKey, setDismissAfterExitKey] = useState<string | null>(null);
  const [visibleAfterIso, setVisibleAfterIso] = useState<string | undefined>();
  const effectiveVisibleAfterIso = visibleAfterIso ?? latestProviderCheckedAt(providers);
  const view = getProviderUpdateSidebarPillView(providers, {
    ...(effectiveVisibleAfterIso !== undefined
      ? { visibleAfterIso: effectiveVisibleAfterIso }
      : {}),
    dismissedKeys,
  });

  if (visibleAfterIso === undefined && effectiveVisibleAfterIso !== undefined) {
    setVisibleAfterIso(effectiveVisibleAfterIso);
  }

  const openProviderSettings = () => {
    void navigate({ to: "/settings/providers" });
  };
  const displayedView = renderedView ?? view;
  const dismissAfterVisibleMs = displayedView?.dismissAfterVisibleMs;
  const viewKey = displayedView?.key ?? null;
  const showDismissProgress =
    dismissAfterVisibleMs !== undefined &&
    displayedView?.tone !== "loading" &&
    exitingKey !== viewKey;

  const startExit = (
    key: string,
    nextView: ProviderUpdateSidebarPillView | null,
    dismissKey?: string,
  ) => {
    if (exitingKey === key) {
      return;
    }
    setPendingView(nextView);
    setExitingKey(key);
    setDismissAfterExitKey(dismissKey ?? null);
  };

  if (exitingKey === null) {
    if (!renderedView) {
      if (view) {
        setRenderedView(view);
      }
    } else if (!view) {
      startExit(renderedView.key, null);
    } else if (view.key !== renderedView.key) {
      startExit(renderedView.key, view);
    }
  }

  const exitAfterVisible = useEffectEvent((key: string) => startExit(key, null, key));

  const finishExit = useEffectEvent(() => {
    if (dismissAfterExitKey !== null) {
      setDismissedKeys((previous) => new Set(previous).add(dismissAfterExitKey));
    }
    setRenderedView(pendingView);
    setPendingView(null);
    setExitingKey(null);
    setDismissAfterExitKey(null);
  });

  useEffect(() => {
    if (exitingKey === null) return;
    // A cancelled or skipped CSS transition must not keep a hidden spinner mounted.
    const timeoutId = window.setTimeout(finishExit, PROVIDER_UPDATE_PILL_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [exitingKey]);

  useEffect(() => {
    if (!dismissAfterVisibleMs || !viewKey) {
      return;
    }
    if (exitingKey === viewKey) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      exitAfterVisible(viewKey);
    }, dismissAfterVisibleMs);

    return () => window.clearTimeout(timeoutId);
  }, [dismissAfterVisibleMs, exitingKey, viewKey]);

  if (!displayedView) {
    return null;
  }

  return (
    <div
      className={`group/provider-update relative flex min-h-8 w-full shrink-0 items-center overflow-hidden rounded-lg text-xs leading-4 font-medium transform-gpu transition-[opacity,translate] duration-180 ease-drawer will-change-transform ${
        PROVIDER_UPDATE_PILL_STYLES[displayedView.tone]
      } ${
        exitingKey === displayedView.key
          ? "pointer-events-none translate-y-1.5 opacity-0"
          : "translate-y-0 opacity-100"
      }`}
    >
      {showDismissProgress ? (
        <div
          key={displayedView.key}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-full origin-left scale-x-0 transition-transform duration-(--provider-update-pill-dismiss-ms) ease-linear starting:scale-x-100 ${
            PROVIDER_UPDATE_PILL_PROGRESS_STYLES[displayedView.tone]
          }`}
          style={
            {
              "--provider-update-pill-dismiss-ms": `${dismissAfterVisibleMs}ms`,
            } as CSSProperties
          }
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors" />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={displayedView.description}
              data-provider-update-main
              className="relative z-[1] flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
              onClick={openProviderSettings}
            >
              {displayedView.tone === "loading" ? (
                <Spinner size="sm" className="shrink-0" />
              ) : displayedView.tone === "success" ? (
                <CircleCheckIcon className="size-3.5 shrink-0" />
              ) : displayedView.tone === "error" ? (
                <TriangleAlertIcon className="size-3.5 shrink-0" />
              ) : (
                <DownloadIcon className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 wrap-break-word">{displayedView.title}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{displayedView.description}</TooltipPopup>
      </Tooltip>
      {displayedView.dismissible && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Dismiss provider update notice"
                className="relative z-[1] mr-1"
                onClick={() => startExit(displayedView.key, null, displayedView.key)}
              >
                <XIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="top">Dismiss until provider status changes</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
