import { SquarePenIcon } from "lucide-react";

import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { HarpMascot } from "./mascot/HarpMascot";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function NoActiveThreadState() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <Empty className="flex-1">
          <EmptyHeader>
            <HarpMascot scene="resting" className="mb-6 h-20 w-auto" />
            <EmptyTitle>Pick a thread to continue</EmptyTitle>
            <EmptyDescription>
              Select an existing thread or create a new one to get started.
            </EmptyDescription>
            <Button
              size="sm"
              className="mt-6"
              onClick={() => openCommandPalette({ open: "new-thread-in" })}
            >
              <SquarePenIcon />
              New thread
            </Button>
          </EmptyHeader>
        </Empty>
      </div>
    </SidebarInset>
  );
}
