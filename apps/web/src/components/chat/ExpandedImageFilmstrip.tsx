import { useAssetUrlState } from "../../assets/assetUrls";
import { cn } from "~/lib/utils";
import type { ExpandedImageItem } from "./ExpandedImagePreview";

export const expandedImageFilmstripHeightPx = 64;
const filmstripLoadRadius = 16;

function scrollThumbIntoView(thumb: HTMLButtonElement | null) {
  thumb?.scrollIntoView({ block: "nearest", inline: "center" });
}

function FilmstripImage({ item }: { item: ExpandedImageItem }) {
  const asset = item.actionsSource?.asset;
  const assetUrl = useAssetUrlState(
    asset?.environmentId ?? null,
    item.src === null && item.type !== "video" ? (asset?.resource ?? null) : null,
  );
  const src = item.src ?? (assetUrl._tag === "Success" ? assetUrl.url : null);
  if (src === null || item.type === "video") return null;
  return (
    <img src={src} alt="" decoding="async" draggable={false} className="size-full object-cover" />
  );
}

export function ExpandedImageFilmstrip({
  images,
  index,
  onSelect,
}: {
  images: ReadonlyArray<ExpandedImageItem>;
  index: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Jump to media"
      data-expanded-image-filmstrip
      className="flex w-fit max-w-full touch-pan-x gap-1.5 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:thin]"
    >
      {images.map((item, position) => {
        const active = position === index;
        return (
          <button
            key={item.src ?? JSON.stringify(item.actionsSource?.asset?.resource)}
            type="button"
            aria-label={`Show ${item.name} ${position + 1} of ${images.length}`}
            aria-current={active ? "true" : undefined}
            ref={active ? scrollThumbIntoView : undefined}
            onClick={() => onSelect(position)}
            className={cn(
              "h-12 w-[4.5rem] shrink-0 overflow-hidden rounded-md border bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
              active ? "border-ring ring-2 ring-ring" : "border-border hover:border-ring",
            )}
          >
            {Math.abs(position - index) <= filmstripLoadRadius ? (
              <FilmstripImage item={item} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
