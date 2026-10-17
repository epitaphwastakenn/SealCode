import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider, SubscriptionUsageWindow } from "@t3tools/contracts";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatProviderDriverKindLabel } from "../../providerModels";
import { environmentPresentations } from "../../state/presentation";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  clampSubscriptionPercent,
  formatSubscriptionPercent,
  formatSubscriptionReset,
} from "../../usage/subscriptionUsage";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ScrollArea } from "../ui/scroll-area";

interface SubscriptionProviderEntry {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly provider: ServerProvider;
}

export function UsagePage() {
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const router = useRouter();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshedEnvironmentKey = useRef<string | null>(null);

  const providers = useMemo<readonly SubscriptionProviderEntry[]>(
    () =>
      [...configs.entries()].flatMap(([environmentId, config]) => {
        const presentation = presentations.get(environmentId);
        const environmentLabel = presentation?.entry.target.label ?? "Connected environment";
        return config.providers
          .filter((provider) => provider.enabled)
          .map((provider) => ({ environmentId, environmentLabel, provider }));
      }),
    [configs, presentations],
  );

  const orderedProviders = useMemo(
    () =>
      [...providers].sort((left, right) => {
        const leftHasUsage = left.provider.subscriptionUsage !== undefined;
        const rightHasUsage = right.provider.subscriptionUsage !== undefined;
        if (leftHasUsage !== rightHasUsage) return leftHasUsage ? -1 : 1;
        return providerDisplayName(left.provider).localeCompare(
          providerDisplayName(right.provider),
        );
      }),
    [providers],
  );

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all(
        [...configs.keys()].map((environmentId) => refreshProviders({ environmentId, input: {} })),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [configs, isRefreshing, refreshProviders]);

  useEffect(() => {
    const environmentKey = [...configs.keys()].join(",");
    if (environmentKey.length === 0 || refreshedEnvironmentKey.current === environmentKey) {
      return;
    }
    refreshedEnvironmentKey.current = environmentKey;
    void handleRefresh();
  }, [configs, handleRefresh]);

  return (
    <ScrollArea className="h-full bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-background px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                if (canGoBack) {
                  router.history.back();
                  return;
                }
                void navigate({ to: "/" });
              }}
              className="mt-1 cursor-pointer rounded-md border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-foreground">Subscription usage</h1>
              <p className="max-w-xl text-sm text-muted-foreground">
                Live quota windows and reported activity from your connected providers.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            aria-label="Refresh subscription usage"
            className="cursor-pointer rounded-md border border-border p-2 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
          </button>
        </header>

        {orderedProviders.length === 0 ? (
          <EmptySubscriptionUsage />
        ) : (
          <section className="grid gap-4 md:grid-cols-2" aria-label="Provider subscription usage">
            {orderedProviders.map((entry) => (
              <SubscriptionProviderCard
                key={`${entry.environmentId}:${entry.provider.instanceId}`}
                entry={entry}
              />
            ))}
          </section>
        )}

        <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          Percentages and reset times come from the provider account. SealCode does not estimate
          subscription limits from token counts. Providers without a quota denominator show their
          reported activity instead of a fabricated percentage.
        </p>
      </div>
    </ScrollArea>
  );
}

function providerDisplayName(provider: ServerProvider): string {
  return provider.displayName?.trim() || formatProviderDriverKindLabel(provider.driver);
}

function EmptySubscriptionUsage() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-border px-6 py-16 text-center">
      <span className="text-sm font-medium text-foreground">No connected subscriptions</span>
      <span className="max-w-md text-sm text-muted-foreground">
        Connect a provider in Settings to see the quota windows or activity it makes available.
      </span>
    </div>
  );
}

function SubscriptionProviderCard({ entry }: { readonly entry: SubscriptionProviderEntry }) {
  const { provider } = entry;
  const usage = provider.subscriptionUsage;
  const name = providerDisplayName(provider);

  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-card/35 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderInstanceIcon
            driverKind={provider.driver}
            displayName={name}
            accentColor={provider.accentColor}
            className="size-8"
            iconClassName="size-6"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">{name}</h2>
            <p className="truncate text-xs text-muted-foreground">{entry.environmentLabel}</p>
          </div>
        </div>
        {usage?.plan ? <span className="text-xs text-muted-foreground">{usage.plan}</span> : null}
      </header>

      {usage ? (
        usage.windows.length > 0 ? (
          <div className="flex flex-col gap-4">
            {usage.windows.map((window) => (
              <SubscriptionUsageBar key={window.id} window={window} />
            ))}
          </div>
        ) : usage.metrics.length > 0 ? (
          <SubscriptionUsageMetrics metrics={usage.metrics} />
        ) : (
          <UnavailableUsage message="The provider did not return any active quota windows." />
        )
      ) : (
        <UnavailableUsage message={unavailableUsageMessage(provider)} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Last checked {formatCheckedAt(usage?.checkedAt ?? provider.checkedAt)}
      </p>
    </article>
  );
}

function unavailableUsageMessage(provider: ServerProvider): string {
  if (provider.availability === "unavailable") {
    return provider.unavailableReason ?? "This provider is unavailable in the current environment.";
  }
  if (!provider.enabled || provider.status === "disabled") {
    return "This provider is disabled in SealCode settings. Enable it to read account usage.";
  }
  if (!provider.installed) {
    return "The provider CLI is not installed or could not be found on this environment.";
  }
  if (provider.status === "error" && provider.message?.trim()) {
    return provider.message.trim();
  }
  switch (provider.driver) {
    case "antigravity":
      return provider.auth.status === "unauthenticated"
        ? "Sign in with Google in Settings > Providers, then refresh account usage."
        : "Antigravity did not return account quota data. Refresh to try again.";
    case "commandcode":
      return "CommandCode quota is unavailable. Sign in through the CommandCode CLI and refresh.";
    case "opencode":
      return "OpenCode did not return local session statistics. Run OpenCode once, then refresh.";
    case "cursor":
      return "Cursor's signed-in session could not be read or has expired. Sign in to Cursor (or run `agent login`), then refresh.";
    default:
      return "This provider does not expose subscription quota data to SealCode.";
  }
}

function SubscriptionUsageMetrics({
  metrics,
}: {
  readonly metrics: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly value: string;
  }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {metrics.map((metric) => (
        <div key={metric.id} className="rounded-md bg-muted/50 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{metric.label}</div>
          <div className="mt-0.5 truncate text-sm font-medium tabular-nums text-foreground">
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubscriptionUsageBar({ window }: { readonly window: SubscriptionUsageWindow }) {
  const percent = clampSubscriptionPercent(window.usedPercent);
  const barClass = percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-amber-400" : "bg-primary";

  return (
    <div className="flex flex-col gap-2" data-testid={`subscription-usage-${window.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">{window.label}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatSubscriptionPercent(percent)} used
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${window.label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>{formatSubscriptionReset(window.resetsAt)}</span>
        <span className="tabular-nums">{formatSubscriptionPercent(100 - percent)} remaining</span>
      </div>
    </div>
  );
}

function UnavailableUsage({ message }: { readonly message: string }) {
  return (
    <p className="rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground">{message}</p>
  );
}

function formatCheckedAt(value: string): string {
  const checkedAt = new Date(value);
  if (Number.isNaN(checkedAt.getTime())) return "recently";
  return checkedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
