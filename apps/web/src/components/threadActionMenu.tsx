import type { ContextMenuItem } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";

export function ThreadActionMenu(props: {
  items: ReadonlyArray<ContextMenuItem<string>>;
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(props.position);
  const [openSubId, setOpenSubId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = props.position.x;
    let y = props.position.y;
    if (x + rect.width > window.innerWidth - pad)
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height > window.innerHeight - pad)
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    if (x !== anchor.x || y !== anchor.y) setAnchor({ x, y });
  }, [anchor.x, anchor.y, props.position.x, props.position.y]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && rootRef.current?.contains(target)) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [props]);

  return (
    <div className="fixed inset-0 z-[70]" aria-hidden>
      <div
        ref={rootRef}
        role="menu"
        aria-label="Thread actions"
        className="dropdown-glass fixed flex min-w-48 max-w-72 flex-col gap-px rounded-xl p-1"
        style={{ left: anchor.x, top: anchor.y } as React.CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        {props.items.map((item) => {
          const hasChildren = Boolean(item.children && item.children.length > 0);
          const isDestructive = Boolean(item.destructive);
          const isDisabled = Boolean(item.disabled);
          const isOpen = openSubId === item.id;
          return (
            <div key={item.id} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup={hasChildren ? "menu" : undefined}
                aria-expanded={hasChildren ? isOpen : undefined}
                disabled={isDisabled}
                className={cn(
                  "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isDisabled && "pointer-events-none opacity-50",
                  isDestructive
                    ? "text-destructive-foreground hover:bg-destructive/10 focus-visible:bg-destructive/10 [&>svg]:text-current"
                    : "text-foreground hover:bg-accent focus-visible:bg-accent hover:text-accent-foreground focus-visible:text-accent-foreground [&>svg]:text-muted-foreground",
                  "[&>svg]:size-4 [&>svg]:shrink-0",
                )}
                onMouseEnter={() => {
                  if (hasChildren) setOpenSubId(item.id);
                }}
                onMouseLeave={() => {
                  if (hasChildren && openSubId === item.id) setOpenSubId(null);
                }}
                onClick={() => {
                  if (isDisabled) return;
                  if (hasChildren) {
                    setOpenSubId((current) => (current === item.id ? null : item.id));
                    return;
                  }
                  props.onSelect(item.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {hasChildren ? <ChevronRightIcon className="size-3.5 opacity-60" /> : null}
              </button>
              {hasChildren && isOpen ? (
                <div
                  role="menu"
                  className="dropdown-glass absolute left-full top-0 ml-1 flex min-w-44 flex-col gap-px rounded-xl p-1"
                  onMouseEnter={() => setOpenSubId(item.id)}
                  onMouseLeave={() => setOpenSubId(null)}
                >
                  {item.children!.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      role="menuitem"
                      disabled={Boolean(child.disabled)}
                      className={cn(
                        "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        child.disabled && "pointer-events-none opacity-50",
                        child.destructive
                          ? "text-destructive-foreground hover:bg-destructive/10"
                          : "text-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                      onClick={() => {
                        if (child.disabled) return;
                        props.onSelect(child.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{child.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
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
  const headingId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);

  const heading =
    props.heading ?? (props.single ? `Delete "${props.title}"?` : `Delete ${props.count} threads?`);
  const body =
    props.description ??
    (props.single
      ? "This permanently clears conversation history for this thread."
      : "This permanently clears conversation history for these threads.");

  return (
    <div className="fixed inset-0 z-[72] grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="dialog-backdrop fixed inset-0"
        onClick={props.onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className="dialog-glass relative flex w-full max-w-md flex-col rounded-2xl border p-6"
      >
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          {heading}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={props.onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
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
  const requestDeleteConfirmation = useCallback((nextRequest: ThreadDeleteConfirmationRequest) => {
    setRequest(nextRequest);
  }, []);
  const requestConfirmation = useCallback(
    (content: ThreadConfirmationContent) =>
      new Promise<boolean>((resolve) => {
        setRequest({
          ...content,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [],
  );
  const close = useCallback(() => setRequest(null), []);

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
