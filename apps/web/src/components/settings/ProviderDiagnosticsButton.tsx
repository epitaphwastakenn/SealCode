import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useState } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

function saveText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Browsers may start downloading after the click's task; defer revocation.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Runs the provider's network and agent checks and shows a report to copy or save. */
export function ProviderDiagnosticsButton({
  environmentId,
  instanceId,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly disabled: boolean;
}) {
  const diagnose = useAtomCommand(serverEnvironment.diagnoseProvider, {
    reportFailure: false,
    reportDefect: false,
  });
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const result = await diagnose({ environmentId, input: { instanceId } });
    setRunning(false);
    if (result._tag === "Success") {
      setReport(result.value.report);
      return;
    }
    const failure = squashAtomCommandFailure(result);
    setError(failure instanceof Error ? failure.message : "Diagnostics failed. Try again.");
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || running}
        title="Checks the network path to Google and starts Antigravity once. Takes up to 3 minutes."
        onClick={() => void run()}
      >
        {running ? "Running diagnostics…" : "Diagnostics"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <Dialog open={report !== null} onOpenChange={(open) => !open && setReport(null)}>
        <DialogPopup size="xl">
          <DialogHeader>
            <DialogTitle>Diagnostics</DialogTitle>
            <DialogDescription>
              Copy or save this report and send it to whoever helps you. It has no passwords, tokens
              or email addresses.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]">
              {report}
            </pre>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => saveText(report ?? "", "sealcode-antigravity-diagnostics.txt")}
            >
              Save
            </Button>
            <Button onClick={() => void writeTextToClipboard(report ?? "", "Diagnostics report")}>
              Copy
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
