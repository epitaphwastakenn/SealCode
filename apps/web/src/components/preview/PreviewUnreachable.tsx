import { FileWarningIcon, GlobeXIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

import { describePreviewError } from "./errorCodeMessages";

interface Props {
  url: string;
  code: number;
  description: string;
  onReload: () => void;
  move?: { readonly label: string; readonly onMove: () => void };
}

export function PreviewFileNotShown({
  url,
  fileName,
  downloadUrl,
  onOpen,
}: {
  url: string;
  fileName: string;
  downloadUrl: string | null;
  onOpen: () => void;
}) {
  const host = safeHost(url) ?? url;
  return (
    <div className="scrollbar-gutter-both relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <Empty size="compact">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileWarningIcon />
          </EmptyMedia>
          <EmptyTitle>This file can&rsquo;t be shown here</EmptyTitle>
          <EmptyDescription>
            <span className="font-medium text-foreground">{fileName}</span> from {host} was
            downloaded instead.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex w-full items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onOpen}>
              Open in browser
            </Button>
            {downloadUrl ? (
              <Button type="button" size="sm" render={<a href={downloadUrl} download={fileName} />}>
                Download
              </Button>
            ) : null}
          </div>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function PreviewUnreachable({ url, code, description, onReload, move }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const host = safeHost(url) ?? url;
  const friendly = describePreviewError(description);
  const errorLabel = description.length > 0 ? description : `ERR_${Math.abs(code) || "FAILED"}`;

  return (
    <div className="scrollbar-gutter-both relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <Empty size="compact">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GlobeXIcon />
          </EmptyMedia>
          <EmptyTitle className="break-words">Can&rsquo;t reach {host}</EmptyTitle>
          <EmptyDescription>{friendly}.</EmptyDescription>
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">{errorLabel}</p>
        </EmptyHeader>
        <Collapsible open={showDetails} onOpenChange={setShowDetails} className="w-full max-w-sm">
          <CollapsiblePanel>
            <div className="mb-4 rounded-lg border border-border/50 bg-foreground/[0.03] p-3 text-left text-sm">
              <p className="mb-2 font-medium text-foreground">Try:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Checking your connection</li>
                <li>Confirming the dev server is running</li>
                {move ? (
                  <li>Opening it in the environment&rsquo;s browser, which reaches its network</li>
                ) : null}
                <li>Checking the proxy and the firewall</li>
              </ul>
            </div>
          </CollapsiblePanel>
          <div className="flex items-center justify-end gap-2">
            <CollapsibleTrigger render={<Button type="button" variant="outline" size="sm" />}>
              {showDetails ? "Hide details" : "Details"}
            </CollapsibleTrigger>
            {move ? (
              <Button type="button" variant="outline" size="sm" onClick={move.onMove}>
                {move.label}
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={onReload}>
              Reload
            </Button>
          </div>
        </Collapsible>
      </Empty>
    </div>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
