import type { IndexItem } from "@vector-image-detection/core/browser";
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
    <figure className={`photo-card${selected ? " photo-card--selected" : ""}`}>
      <div className="photo-card__media">
        <button
          type="button"
          className="photo-card__hit"
          aria-pressed={onActivate ? selected : undefined}
          aria-label={`${action} ${label}`}
          onClick={() => onActivate?.(item.id)}
        >
          {/* Dimensions match the fixture thumbnails so the grid never reflows as
              images decode; object-fit absorbs any other source ratio. */}
          <img
            className="photo-card__image"
            src={thumbUrl}
            alt=""
            width={192}
            height={192}
            loading="lazy"
            decoding="async"
          />
        </button>
        <AttributionPopover item={item} />
        {badge !== undefined && <span className="photo-card__badge">{badge}</span>}
      </div>

      <figcaption className="photo-card__caption">
        <span className="photo-card__label" title={item.file}>
          {label}
        </span>
        {score !== undefined && <span className="photo-card__score">{formatScore(score)}</span>}
      </figcaption>

      {tags.length > 0 && (
        <ul className="photo-card__tags">
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
