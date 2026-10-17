import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  availableDecisions?: ReadonlyArray<string> | undefined;
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  availableDecisions,
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <>
      {(!availableDecisions || availableDecisions.includes("cancel")) && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "cancel")}
        >
          Cancel turn
        </Button>
      )}
      {(!availableDecisions || availableDecisions.includes("decline")) && (
        <Button
          size="sm"
          variant="destructive-outline"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "decline")}
        >
          Decline
        </Button>
      )}
      {(!availableDecisions || availableDecisions.includes("acceptForSession")) && (
        <Button
          size="sm"
          variant="outline"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
        >
          Always allow this session
        </Button>
      )}
      {(!availableDecisions || availableDecisions.includes("accept")) && (
        <Button
          size="sm"
          variant="default"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "accept")}
        >
          Approve once
        </Button>
      )}
    </>
  );
});
