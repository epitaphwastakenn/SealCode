import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DESKTOP_DOWNLOAD_URL } from "~/branding";
import { isElectron } from "../env";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { CommandBlock } from "./CommandBlock";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { HarpMascot } from "./mascot/HarpMascot";
import { RouteInset } from "./RouteInset";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/** Home screen for the hosted app before any computer is added. */
export function HostedEmptyState() {
  const localEnvironmentOff = isLocalEnvironmentDisabled();

  return (
    <RouteInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {isElectron ? <WorkspacePageHeader electron /> : null}

        <Empty className="flex-1">
          <EmptyHeader>
            <HarpMascot scene="sleeping" className="mb-6 h-20 w-auto" />
            <EmptyTitle>
              {localEnvironmentOff ? "This computer is off" : "No computer connected"}
            </EmptyTitle>
            <EmptyDescription>
              {localEnvironmentOff
                ? "Turn it back on, or connect a different computer."
                : "Your agents run on your computer. Start Harp there first."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {localEnvironmentOff ? (
              <Button render={<Link to="/settings/connections" />} size="sm">
                Open Connections
              </Button>
            ) : (
              <ol className="w-full space-y-4 text-left">
                <PairingSteps />
              </ol>
            )}
          </EmptyContent>
        </Empty>
      </div>
    </RouteInset>
  );
}

function PairingSteps() {
  return (
    <>
      <SetupStep number={1}>
        <RunOnComputer command="t3 pair" />
      </SetupStep>
      <SetupStep number={2}>
        <Button render={<Link to="/settings/connections" />} size="sm">
          Add pairing link
        </Button>
      </SetupStep>
    </>
  );
}

function SetupStep({
  number,
  children,
}: {
  readonly number: number;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="w-2 shrink-0 pt-1 text-muted-foreground">{number}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function RunOnComputer({ command }: { readonly command: string }) {
  return (
    <>
      <p>Run on your computer:</p>
      <CommandBlock command={command} className="mt-2" />
      <a
        className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        Or download the desktop app
      </a>
    </>
  );
}
