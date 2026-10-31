import type { ContextMenuItem } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "./ui/menu";

function ThreadActionMenuEntry(props: {
  item: ContextMenuItem<string>;
  onSelect: (id: string) => void;
}) {
  const { item } = props;
  return (
    <MenuItem
      disabled={Boolean(item.disabled)}
      variant={item.destructive ? "destructive" : "default"}
      onClick={() => props.onSelect(item.id)}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.checked ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
    </MenuItem>
  );
}

export function ThreadActionMenu(props: {
  items: ReadonlyArray<ContextMenuItem<string>>;
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const anchor = {
    getBoundingClientRect: () => new DOMRect(props.position.x, props.position.y, 0, 0),
  };
  return (
    <Menu
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MenuPopup
        anchor={anchor}
        align="start"
        side="bottom"
        sideOffset={0}
        aria-label="Thread actions"
        className="min-w-48 max-w-72"
      >
        {props.items.map((item, index) => {
          const hasChildren = Boolean(item.children && item.children.length > 0);
          return (
            <Fragment key={item.id}>
              {item.separatorBefore && index > 0 ? <MenuSeparator /> : null}
              {item.header ? (
                <div
                  role="presentation"
                  className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground"
                >
                  {item.label}
                </div>
              ) : hasChildren ? (
                <MenuSub>
                  <MenuSubTrigger disabled={Boolean(item.disabled)}>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </MenuSubTrigger>
                  <MenuSubPopup className="min-w-44">
                    {item.children!.map((child, childIndex) => (
                      <Fragment key={child.id}>
                        {child.separatorBefore && childIndex > 0 ? <MenuSeparator /> : null}
                        <ThreadActionMenuEntry item={child} onSelect={props.onSelect} />
                      </Fragment>
                    ))}
                  </MenuSubPopup>
                </MenuSub>
              ) : (
                <ThreadActionMenuEntry item={item} onSelect={props.onSelect} />
              )}
            </Fragment>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

export function DeleteThreadConfirmDialog(props: {
  title: string;
  count: number;
  single: boolean;
  heading?: string;
  description?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const heading =
    props.heading ?? (props.single ? `Delete "${props.title}"?` : `Delete ${props.count} threads?`);
  const body =
    props.description ??
    (props.single
      ? "This permanently clears conversation history for this thread."
      : "This permanently clears conversation history for these threads.");

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{heading}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" onClick={props.onConfirm}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export interface ThreadDeleteConfirmationRequest {
  readonly title: string;
  readonly count: number;
  readonly single: boolean;
  readonly heading?: string;
  readonly description?: string;
  readonly onConfirm: () => void | Promise<void>;
}

export type ThreadConfirmationContent = Omit<ThreadDeleteConfirmationRequest, "onConfirm">;

type PendingThreadConfirmation = ThreadConfirmationContent & {
  readonly onConfirm: () => void | Promise<void>;
  readonly onCancel?: () => void;
};

/**
 * Shared in-app confirmation state for thread deletion surfaces. Keeping the
 * confirmation in React means desktop uses the same themed dialog as web and
 * remote clients instead of falling through to the native dialog bridge.
 */
export function useThreadDeleteConfirmation(): {
  requestDeleteConfirmation: (request: ThreadDeleteConfirmationRequest) => void;
  requestConfirmation: (request: ThreadConfirmationContent) => Promise<boolean>;
  deleteConfirmDialog: ReactNode;
} {
  const [request, setRequest] = useState<PendingThreadConfirmation | null>(null);
  const requestDeleteConfirmation = (nextRequest: ThreadDeleteConfirmationRequest) => {
    setRequest(nextRequest);
  };
  const requestConfirmation = (content: ThreadConfirmationContent) =>
    new Promise<boolean>((resolve) => {
      setRequest({
        ...content,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  const close = () => setRequest(null);

  const deleteConfirmDialog = request ? (
    <DeleteThreadConfirmDialog
      title={request.title}
      count={request.count}
      single={request.single}
      {...(request.heading ? { heading: request.heading } : {})}
      {...(request.description ? { description: request.description } : {})}
      onCancel={() => {
        const cancelledRequest = request;
        close();
        cancelledRequest.onCancel?.();
      }}
      onConfirm={() => {
        const confirmedRequest = request;
        close();
        void confirmedRequest.onConfirm();
      }}
    />
  ) : null;

  return { requestDeleteConfirmation, requestConfirmation, deleteConfirmDialog };
}
