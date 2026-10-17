import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";
import { SidebarInset } from "../components/ui/sidebar";

function UsageRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <UsagePage />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/usage")({
  component: UsageRouteView,
});
