import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  SubscriptionUsageMetric,
  SubscriptionUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import {
  clampSubscriptionPercent,
  collectSubscriptionUsageEntries,
  formatSubscriptionPercent,
  formatSubscriptionReset,
  providerEntryName,
  type SubscriptionUsageEntry,
} from "../../usage/subscriptionUsage";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { PROVIDER_PRESENTATION } from "./usageProviders";

/**
 * Provider-reported quota windows and activity that the limits view above does not already
 * draw. Percentages and reset times come from the provider account; Harp never estimates
 * a quota from token counts.
 */
export function SubscriptionUsageSection({
  selectedEnvironmentIds,
  hiddenProviders,
  now,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly now: number;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // Only providers that actually reported something get a card; the V2 server
  // does not fill subscription usage for most drivers yet, and a wall of
  // "unavailable" cards would read as an error.
  const entries = collectSubscriptionUsageEntries(presentations, {
    selectedEnvironmentIds,
    hiddenDrivers: new Set(
      [...hiddenProviders].map((kind) => PROVIDER_PRESENTATION[kind].driverKind),
    ),
  }).filter((entry) => entry.unavailableReason === null);
  if (entries.length === 0) return null;

  return (
    <section aria-label="Provider subscription usage" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-foreground">Subscription usage</h2>
        <p className="text-xs text-muted-foreground">
          Quota windows and reported activity from your connected providers. Providers without a
          quota denominator show their activity instead of an estimated percentage.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => (
          <SubscriptionProviderCard
            key={`${entry.environmentId}:${entry.provider.instanceId}`}
            entry={entry}
            now={now}
          />
        ))}
      </div>
    </section>
  );
}

function SubscriptionProviderCard({
  entry,
  now,
}: {
  readonly entry: SubscriptionUsageEntry;
  readonly now: number;
}) {
  const { provider } = entry;
  const name = providerEntryName(provider);

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
            <h3 className="truncate text-sm font-medium text-foreground">{name}</h3>
            <p className="truncate text-xs text-muted-foreground">{entry.environmentLabel}</p>
          </div>
        </div>
        {entry.plan ? <span className="text-xs text-muted-foreground">{entry.plan}</span> : null}
      </header>

      {entry.windows.length > 0 ? (
        <div className="flex flex-col gap-4">
          {entry.windows.map((window) => (
            <SubscriptionUsageBar key={window.id} window={window} now={now} />
          ))}
        </div>
      ) : null}
      {entry.metrics.length > 0 ? <SubscriptionUsageMetrics metrics={entry.metrics} /> : null}
      {entry.unavailableReason ? (
        <p className="rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
          {entry.unavailableReason}
        </p>
      ) : null}

      <p className="text-3xs text-muted-foreground">
        Last checked {formatCheckedAt(entry.checkedAt)}
      </p>
    </article>
  );
}

function SubscriptionUsageMetrics({
  metrics,
}: {
  readonly metrics: ReadonlyArray<SubscriptionUsageMetric>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {metrics.map((metric) => (
        <div key={metric.id} className="rounded-md bg-muted/50 px-3 py-2">
          <div className="text-3xs text-muted-foreground">{metric.label}</div>
          <div className="mt-0.5 truncate text-sm font-medium tabular-nums text-foreground">
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubscriptionUsageBar({
  window,
  now,
}: {
  readonly window: SubscriptionUsageWindow;
  readonly now: number;
}) {
  const percent = clampSubscriptionPercent(window.usedPercent);
  const barClass = percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-primary";

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
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between gap-3 text-3xs text-muted-foreground">
        <span>{formatSubscriptionReset(window.resetsAt, new Date(now))}</span>
        <span className="tabular-nums">{formatSubscriptionPercent(100 - percent)} remaining</span>
      </div>
    </div>
  );
}

function formatCheckedAt(value: string): string {
  const checkedAt = new Date(value);
  if (Number.isNaN(checkedAt.getTime())) return "recently";
  return checkedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
