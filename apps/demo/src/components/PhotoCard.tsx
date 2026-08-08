import type { IndexItem } from "../generated/core-browser.mjs";
import type { ReactNode } from "react";
import { formatScore, itemLabel } from "../lib/format";
import { AttributionPopover } from "./AttributionPopover";
import { TagChip } from "./TagChip";

export interface PhotoCardProps {
  item: IndexItem;
  thumbUrl: string;
  tags?: readonly string[];
  /** Subset of `tags` the user added themselves — index tags are not removable from the demo UI. */
  removableTags?: readonly string[];
  score?: number;
  selected?: boolean;
  /** Verb used in the image button's accessible name — the click means different things per view. */
  action?: string;
  badge?: ReactNode;
  footer?: ReactNode;
  onActivate?: (id: string) => void;
  onRemoveTag?: (id: string, tag: string) => void;
}

export function PhotoCard({
  item,
  thumbUrl,
  tags = [],
  removableTags = [],
  score,
  selected = false,
  action = "Show photos similar to",
  badge,
  footer,
  onActivate,
  onRemoveTag,
}: PhotoCardProps) {
  const label = itemLabel(item);

  return (
    <figure
      className={`m-0 flex flex-col gap-xs rounded-md border bg-surface p-xs transition-colors motion-reduce:transition-none ${selected ? "border-accent shadow-selected" : "border-line"}`}
    >
      <div className="relative">
        <button
          type="button"
          className="block min-h-control w-full cursor-pointer rounded-sm border-0 bg-transparent p-0 active:opacity-80"
          aria-pressed={onActivate ? selected : undefined}
          aria-label={`${action} ${label}`}
          onClick={() => onActivate?.(item.id)}
        >
          {/* Dimensions match the fixture thumbnails so the grid never reflows as
              images decode; object-fit absorbs any other source ratio. */}
          <img
            className="aspect-square h-auto w-full rounded-sm bg-sunken object-cover"
            src={thumbUrl}
            alt=""
            width={192}
            height={192}
            loading="lazy"
            decoding="async"
          />
        </button>
        <AttributionPopover item={item} />
        {badge !== undefined && (
          <span className="absolute top-3xs left-3xs rounded-pill border border-line bg-surface px-xs py-3xs text-2xs font-semibold">
            {badge}
          </span>
        )}
      </div>

      <figcaption className="flex items-baseline justify-between gap-xs text-xs text-muted">
        <span className="truncate" title={item.file}>
          {label}
        </span>
        {score !== undefined && (
          <span className="font-semibold text-ink tabular-nums">{formatScore(score)}</span>
        )}
      </figcaption>

      {tags.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-3xs p-0">
          {tags.map((tag) => (
            <li key={tag}>
              <TagChip
                tag={tag}
                onRemove={
                  onRemoveTag && removableTags.includes(tag)
                    ? () => onRemoveTag(item.id, tag)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}

      {footer}
    </figure>
  );
}
