import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { HarpMascot } from "./mascot/HarpMascot";
import { PanelSubheader } from "./PanelSubheader";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";

export function DiffPanelShell(props: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background">
      <PanelSubheader className="justify-between gap-2">{props.header}</PanelSubheader>
      {props.children}
    </div>
  );
}

export function DiffPanelEmpty(props: { title: string; description?: string }) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <HarpMascot scene="sleeping" className="mb-4 h-16 w-auto" />
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description ? <EmptyDescription>{props.description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

export function DiffPanelError(props: {
  title: string;
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <Alert variant="error" className="m-2 shrink-0">
      <TriangleAlertIcon />
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
      {props.onRetry ? (
        <AlertAction>
          <Button size="xs" variant="outline" onClick={props.onRetry}>
            Retry
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

export function DiffFileHeaderSkeleton({
  titleWidth,
}: {
  titleWidth: "short" | "medium" | "long";
}) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 pr-3">
      <div className="flex size-5 shrink-0 items-center justify-center">
        <Skeleton className="size-2.5" />
      </div>
      <Skeleton className="size-5 shrink-0" />
      <Skeleton
        shape="pill"
        className={
          titleWidth === "short"
            ? "h-3 w-2/5 max-w-52"
            : titleWidth === "medium"
              ? "h-3 w-1/2 max-w-64"
              : "h-3 w-3/5 max-w-72"
        }
      />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton shape="pill" className="h-3 w-5" />
        <Skeleton shape="pill" className="h-3 w-5" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton({ width }: { width: "short" | "medium" | "long" }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton shape="pill" className="h-2.5 w-5 shrink-0" />
      <Skeleton
        shape="pill"
        className={
          width === "short" ? "h-2.5 w-3/5" : width === "medium" ? "h-2.5 w-2/3" : "h-2.5 w-4/5"
        }
      />
    </div>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <DiffFileHeaderSkeleton titleWidth="medium" />
      <div className="flex h-6 items-center gap-2 px-2 pr-3">
        <div className="h-px flex-1 bg-border/50" />
        <Skeleton shape="pill" className="h-2.5 w-24" />
        <div className="h-px flex-1 bg-border/50" />
      </div>
      <div className="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton width="medium" />
        <DiffCodeLineSkeleton width="long" />
        <DiffCodeLineSkeleton width="short" />
      </div>
      <DiffFileHeaderSkeleton titleWidth="short" />
      <DiffFileHeaderSkeleton titleWidth="long" />
      <span className="sr-only">{props.label}</span>
    </div>
  );
}
