import {
  memo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Image as ImageGlyph, Text as TextGlyph } from "lucide";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { MorphIcon } from "~/components/MorphIcon";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import type { ExpandedImageItem, ExpandedImagePreview } from "./ExpandedImagePreview";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import { useAssetUrlRefresh, useAssetUrls, useAssetUrlState } from "../../assets/assetUrls";
import { ExpandedImageFilmstrip, expandedImageFilmstripHeightPx } from "./ExpandedImageFilmstrip";
import { OpenMediaLink } from "../media/OpenMediaLink";
import { MediaActions, type MediaActionSource } from "../media/MediaActions";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { isContextMenuOpen } from "../../contextMenuFallback";
import {
  SnapShotAccessibilityData,
  SnapShotContentsButton,
  snapShotAccessibilityDetails,
} from "./SnapShotAttachmentDetails";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZoomableImage, type ZoomableImageHandle } from "./ZoomableImage";
import { cn } from "~/lib/utils";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useAtomValue } from "@effect/atom-react";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { expandedImageKey } from "./ExpandedImagePreview";
import { registerThreadOverlay } from "./threadOverlayRetention";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

const EXPANDED_MEDIA_STATE_CLASS_NAME =
  "flex aspect-auto h-48 min-h-0 w-[min(var(--media-width),32rem)] flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-black p-6 text-center text-sm text-white shadow-2xl";

function ExpandedMediaFailure({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className={EXPANDED_MEDIA_STATE_CLASS_NAME}>
      {children}
    </div>
  );
}

const swipeDistancePx = 48;

function NeighbourImagePrefetch({
  environmentId,
  resources,
}: {
  readonly environmentId: EnvironmentId;
  readonly resources: ReadonlyArray<AssetResource>;
}) {
  const urls = useAssetUrls(environmentId, resources);
  return resources.map((resource, position) => {
    const url = urls[position];
    return url === null || url === undefined ? null : (
      <img
        key={JSON.stringify(resource)}
        src={url}
        alt=""
        aria-hidden
        decoding="async"
        className="hidden"
      />
    );
  });
}

function ExpandedVideo({ item }: { readonly item: ExpandedImageItem }) {
  const asset = item.actionsSource?.asset;
  const assetUrl = useAssetUrlState(asset?.environmentId ?? null, asset?.resource ?? null);
  const refreshAssetUrl = useAssetUrlRefresh(asset?.environmentId ?? null, asset?.resource ?? null);
  const src = asset
    ? assetUrl._tag === "Success"
      ? assetUrl.url + (item.srcFragment ?? "")
      : null
    : item.src;
  return (
    <MediaVideoPlayer
      src={src}
      label={item.name}
      sourceFailed={assetUrl._tag === "Failure"}
      originalUrl={item.originalUrl}
      preload="metadata"
      autoPlay={item.autoPlay ?? true}
      className="block max-h-[var(--media-height)] max-w-[var(--media-width)] text-center"
      videoClassName="aspect-auto max-h-[var(--media-height)] w-auto max-w-[var(--media-width)] rounded-lg border border-border/70 shadow-2xl"
      stateClassName={EXPANDED_MEDIA_STATE_CLASS_NAME}
      onRetry={asset ? refreshAssetUrl : undefined}
    />
  );
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [imageOffset, setImageOffset] = useState(0);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [accessibilityDetailsSrc, setAccessibilityDetailsSrc] = useState<string | null>(null);
  const zoomableImageRef = useRef<ZoomableImageHandle>(null);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [returnFocusTarget] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  // The host unmounts the dialog outright, so Base UI never runs finalFocus. Without
  // this, focus stays on the removed dialog, and the composer that owned the opener
  // reads that as a blur and rests.
  const close = () => {
    flushSync(onClose);
    if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
  };
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const imageCount = preview.images.length;
  const index =
    imageCount > 0 ? (((preview.index + imageOffset) % imageCount) + imageCount) % imageCount : 0;
  const item = preview.images[index];
  const source: MediaActionSource = item?.actionsSource ?? {
    kind: item?.type === "video" ? "video" : "image",
    name: item?.name ?? "Media",
    src: item?.src ?? null,
  };
  const openFile = source.onOpenFile;
  const actionsSource: MediaActionSource = openFile
    ? {
        ...source,
        onOpenFile: () => {
          openFile();
          close();
        },
      }
    : source;

  const assetSource =
    item !== undefined && item.src === null && item.type !== "video"
      ? item.actionsSource?.asset
      : undefined;
  const assetUrl = useAssetUrlState(
    assetSource?.environmentId ?? null,
    assetSource?.resource ?? null,
  );
  const imageSrc = item?.src ?? (assetUrl._tag === "Success" ? assetUrl.url : null);
  const imageLoading = assetSource !== undefined && assetUrl._tag === "Loading";
  const neighbourAssets = [
    ...new Set([(index + imageCount - 1) % imageCount, (index + 1) % imageCount]),
  ].flatMap((neighbour) => {
    const neighbourItem = preview.images[neighbour];
    const asset = neighbourItem?.actionsSource?.asset;
    return neighbour === index ||
      neighbourItem === undefined ||
      neighbourItem.src !== null ||
      neighbourItem.type === "video" ||
      asset === undefined
      ? []
      : [asset];
  });

  const navigateImage = (direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  };

  const goToImage = (target: number) => {
    setImageOffset(target - preview.index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isContextMenuOpen() || event.target instanceof HTMLVideoElement)
      return;
    if (zoomableImageRef.current?.pan(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (preview.images.length <= 1) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(1);
      return;
    }
    if (event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    goToImage(event.key === "Home" ? 0 : imageCount - 1);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const inFilmstrip =
      event.target instanceof Element &&
      event.target.closest("[data-expanded-image-filmstrip]") !== null;
    swipeStartRef.current =
      event.pointerType === "mouse" || imageCount <= 1 || inFilmstrip
        ? null
        : { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (start === null || start.pointerId !== event.pointerId) return;
    if (zoomableImageRef.current?.isZoomed()) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < swipeDistancePx || Math.abs(dx) < Math.abs(dy) * 2) return;
    navigateImage(dx < 0 ? 1 : -1);
  };

  if (!item) return null;
  const showFilmstrip = preview.filmstrip === true && imageCount > 1;
  const mediaLabel = item.type === "video" ? "video" : "image";
  const openOriginalLink =
    item.originalUrl && resolveExternalWebLinkHost(item.originalUrl) !== null ? (
      <OpenMediaLink originalUrl={item.originalUrl} />
    ) : null;
  const accessibilityDetails = item.source ? snapShotAccessibilityDetails(item.source) : undefined;
  const showingAccessibilityDetails =
    Boolean(accessibilityDetails) && accessibilityDetailsSrc === item.src;
  const contentsLabel = showingAccessibilityDetails
    ? "Show screenshot"
    : accessibilityDetails?.format === "json"
      ? "Show accessibility JSON"
      : "Show extracted text";

  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        // Escape belongs to an open context menu first.
        if (eventDetails.reason === "escape-key" && isContextMenuOpen()) {
          eventDetails.cancel();
          return;
        }
        close();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className={cn(
          "row-start-1 h-full max-h-[92vh] w-[92vw] max-w-[92vw] touch-pan-y items-center justify-center overflow-visible [--media-width:92vw] sm:[--media-width:calc(92vw-96px)]",
          showFilmstrip
            ? "[--media-height:min(calc((100vh-var(--native-titlebar-height,0px))*0.86),calc(100vh-var(--native-titlebar-height,0px)-224px))]"
            : "[--media-height:min(calc((100vh-var(--native-titlebar-height,0px))*0.86),calc(100vh-var(--native-titlebar-height,0px)-160px))]",
        )}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
        initialFocus={closeButtonRef}
        finalFocus={() => returnFocusTarget}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <DialogTitle className="sr-only">Expanded {mediaLabel} preview</DialogTitle>
        <Button
          type="button"
          ref={closeButtonRef}
          size="icon-sm"
          variant="media-close"
          className="absolute right-0 top-0 z-20"
          onClick={close}
          aria-label={`Close ${mediaLabel} preview`}
        >
          <XIcon />
        </Button>
        {preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="media-navigation"
            className="left-0 top-auto bottom-0 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            aria-label="Previous media"
            onClick={() => navigateImage(-1)}
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        )}
        <MediaActions source={actionsSource}>
          <div className="relative isolate z-10 flex max-h-full max-w-[var(--media-width)] flex-col items-center">
            {item.type === "video" ? (
              <ExpandedVideo key={index} item={item} />
            ) : showingAccessibilityDetails ? (
              accessibilityDetails ? (
                <SnapShotAccessibilityData
                  details={accessibilityDetails}
                  className="h-[min(var(--media-height),40rem)] w-[min(var(--media-width),42rem)] transition-opacity duration-140 ease-out starting:opacity-0 rounded-lg border border-border/70 bg-background p-4 text-xs leading-5 shadow-2xl motion-reduce:transition-none"
                />
              ) : null
            ) : imageLoading ? (
              <div className={EXPANDED_MEDIA_STATE_CLASS_NAME}>
                <Spinner size="lg" />
              </div>
            ) : imageSrc === null || failedImageSrc === imageSrc ? (
              <ExpandedMediaFailure>
                <p>
                  {openOriginalLink
                    ? "This image could not be loaded."
                    : "Image unavailable. The file may have been moved or deleted."}
                </p>
                {openOriginalLink}
              </ExpandedMediaFailure>
            ) : (
              <ZoomableImage
                ref={zoomableImageRef}
                key={`${index}:${imageSrc}`}
                src={imageSrc}
                name={item.name}
                mimeType={item.mimeType}
                reservedHeight={showFilmstrip ? expandedImageFilmstripHeightPx : 0}
                onError={() => setFailedImageSrc(imageSrc)}
              />
            )}
            <div className="mt-2 flex max-w-[var(--media-width)] items-center justify-center gap-1.5 text-xs text-white/80 max-sm:px-10">
              <span className="truncate" aria-live="polite" aria-atomic="true">
                {item.name}
                {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
              </span>
              {accessibilityDetails && item.source ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={contentsLabel}
                        aria-pressed={showingAccessibilityDetails}
                        onClick={() =>
                          setAccessibilityDetailsSrc(showingAccessibilityDetails ? null : item.src)
                        }
                        size="icon-micro"
                        variant="overlay"
                      />
                    }
                  >
                    <MorphIcon
                      className="size-3"
                      aria-hidden="true"
                      icon={showingAccessibilityDetails ? ImageGlyph : TextGlyph}
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{contentsLabel}</TooltipPopup>
                </Tooltip>
              ) : item.source ? (
                <SnapShotContentsButton source={item.source} side="top" />
              ) : null}
            </div>
          </div>
        </MediaActions>
        {showFilmstrip ? (
          <div className="absolute inset-x-0 bottom-0 z-20 mx-auto flex w-fit max-w-[var(--media-width)] max-sm:max-w-[calc(var(--media-width)-6rem)]">
            <ExpandedImageFilmstrip images={preview.images} index={index} onSelect={goToImage} />
          </div>
        ) : null}
        {neighbourAssets[0] ? (
          <NeighbourImagePrefetch
            environmentId={neighbourAssets[0].environmentId}
            resources={neighbourAssets.map((asset) => asset.resource)}
          />
        ) : null}
        {preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="media-navigation"
            className="right-0 top-auto bottom-0 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            aria-label="Next media"
            onClick={() => navigateImage(1)}
          >
            <ChevronRightIcon className="size-5" />
          </Button>
        )}
      </DialogPopup>
    </Dialog>
  );
});

// Keep preview state outside ChatView to isolate dialog renders.
type ExpandedImagePreviewState = {
  readonly threadKey: string;
  readonly preview: ExpandedImagePreview;
} | null;

const expandedImagePreviewAtom = Atom.make<ExpandedImagePreviewState>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:expanded-image-preview"),
);

function ownedSrc(state: ExpandedImagePreviewState): string | null {
  const item = state?.preview.images[state.preview.index];
  return item?.ownsSrc === true ? item.src : null;
}

// The preview owns a blob URL made for it, so whatever replaces it releases that URL.
function setExpandedImagePreview(next: ExpandedImagePreviewState): void {
  const previous = ownedSrc(appAtomRegistry.get(expandedImagePreviewAtom));
  appAtomRegistry.set(expandedImagePreviewAtom, next);
  if (previous !== null && previous !== ownedSrc(next)) URL.revokeObjectURL(previous);
}

export function openExpandedImagePreview(threadKey: string, preview: ExpandedImagePreview): void {
  setExpandedImagePreview({ threadKey, preview });
}

function closeExpandedImagePreview(): void {
  setExpandedImagePreview(null);
}

// Leaving the thread's route (or the chat view) drops its preview.
registerThreadOverlay((threadKey) => {
  const current = appAtomRegistry.get(expandedImagePreviewAtom);
  if (current !== null && current.threadKey !== threadKey) closeExpandedImagePreview();
});

export function ExpandedImageDialogHost({ threadKey }: { readonly threadKey: string }) {
  const state = useAtomValue(expandedImagePreviewAtom);
  const preview = state?.threadKey === threadKey ? state.preview : null;
  if (preview === null) return null;
  return (
    <ExpandedImageDialog
      key={expandedImageKey(preview)}
      preview={preview}
      onClose={closeExpandedImagePreview}
    />
  );
}
