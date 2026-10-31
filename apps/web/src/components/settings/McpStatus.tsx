import { RefreshCwIcon } from "lucide-react";
import type { GlobalMcpServerStatusState } from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const stateBadges = {
  ready: { variant: "success", label: "Connected" },
  connecting: { variant: "info", label: "Connecting…" },
  error: { variant: "error", label: "Error" },
  stopped: { variant: "secondary", label: "Stopped" },
  disabled: { variant: "secondary", label: "Off" },
} as const satisfies Record<
  GlobalMcpServerStatusState,
  { variant: "success" | "info" | "error" | "secondary"; label: string }
>;

export function McpStatusBadge({ state }: { readonly state: GlobalMcpServerStatusState }) {
  const badge = stateBadges[state];
  return (
    <Badge variant={badge.variant} size="sm">
      {badge.label}
    </Badge>
  );
}

export function McpReconnectButton({
  label,
  reconnecting,
  onReconnect,
}: {
  readonly label: string;
  readonly reconnecting: boolean;
  readonly onReconnect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`Reconnect ${label}`}
            disabled={reconnecting}
            onClick={onReconnect}
            size="icon-xs"
            type="button"
            variant="ghost-muted"
          >
            {reconnecting ? <Spinner /> : <RefreshCwIcon />}
          </Button>
        }
      />
      <TooltipPopup side="top">Reconnect</TooltipPopup>
    </Tooltip>
  );
}
