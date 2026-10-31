import {
  formatProviderSubagentStatus,
  type ProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { ArrowUpLeftIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export function ProviderSubagentBar(props: {
  readonly provider: ProviderInstanceEntry | null;
  readonly showInstanceBadge: boolean;
  readonly modelLabel: string;
  readonly effortLabel: string | null;
  readonly status: ProviderSubagentStatus | null;
  readonly onOpenParent: (() => void) | null;
}) {
  const statusRef = useRef<HTMLSpanElement>(null);
  const { status } = props;
  const live = status !== null && isOrchestrationV2WorkActive(status.status);
  const modelDescription =
    props.effortLabel === null ? props.modelLabel : `${props.modelLabel}, ${props.effortLabel}`;
  const announcement = formatProviderSubagentStatus(
    status === null ? null : { ...status, startedAt: null },
    0,
  );

  // Write timer labels to the DOM to avoid chat renders on each tick.
  useLayoutEffect(() => {
    const update = () => {
      if (statusRef.current) {
        statusRef.current.textContent = formatProviderSubagentStatus(status, Date.now());
      }
    };
    update();
    if (!live) return;
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [live, status]);

  return (
    <div className="px-1 py-1 text-xs [--composer-banner-icon-column:--spacing(8)]">
      <ComposerBanner.Row>
        <ComposerBanner.Icon aria-hidden={false}>
          {props.provider ? (
            <ProviderInstanceIcon
              driverKind={props.provider.driverKind}
              displayName={props.provider.displayName}
              accentColor={props.provider.accentColor}
              acpRegistryAgentId={props.provider.acpRegistryAgentId}
              acpRegistryIconUrl={props.provider.acpRegistryIconUrl}
              showBadge={props.showInstanceBadge}
              className="size-4 shrink-0"
              iconClassName="size-4"
              badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
            />
          ) : null}
        </ComposerBanner.Icon>
        <ComposerBanner.Content className="gap-2 text-sm @max-[560px]/composer-surface:flex-col @max-[560px]/composer-surface:items-start @max-[560px]/composer-surface:gap-0">
          <span className="flex min-w-0 max-w-full items-center gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">{props.modelLabel}</span>
            {props.effortLabel === null ? null : (
              <span className="shrink-0 text-muted-foreground">{props.effortLabel}</span>
            )}
          </span>
          <span
            ref={statusRef}
            aria-hidden
            className="min-w-0 max-w-full truncate text-xs text-muted-foreground tabular-nums"
          />
        </ComposerBanner.Content>
        <span role="status" className="sr-only">
          {`${modelDescription} subagent: ${announcement}`}
        </span>
        {props.onOpenParent ? (
          <ComposerBanner.Actions>
            <Button size="xs" variant="ghost-muted" onClick={props.onOpenParent}>
              <ArrowUpLeftIcon />
              <span className="@max-[320px]/composer-surface:sr-only">Open parent</span>
            </Button>
          </ComposerBanner.Actions>
        ) : null}
      </ComposerBanner.Row>
    </div>
  );
}
