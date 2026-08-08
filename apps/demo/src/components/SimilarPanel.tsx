import { useEffect, useState } from "react";
import { formatScore, itemLabel } from "../lib/format";
import { rankByVector, type RankedItem } from "../lib/search";
import type { DemoContext } from "../types";
import { AttributionPopover } from "./AttributionPopover";
import { ScoreBar } from "./ScoreBar";

const NEIGHBOUR_LIMIT = 8;

export function SimilarPanel({ ctx, onClose }: { ctx: DemoContext; onClose: () => void }) {
  const { index, selectedId } = ctx;
  const [neighbours, setNeighbours] = useState<RankedItem[] | null>(null);

  const item = selectedId === null ? undefined : index.itemById.get(selectedId);
  const vector = selectedId === null ? undefined : index.vectorById.get(selectedId);

  useEffect(() => {
    if (!vector || selectedId === null) return;
    let cancelled = false;
    setNeighbours(null);

    // Runs against the precomputed vectors, so this needs no embedder and works
    // even while a real text tower is still downloading.
    void rankByVector(index.store, index.itemById, vector, NEIGHBOUR_LIMIT, {
      excludeId: selectedId,
    }).then((ranked) => {
      if (!cancelled) setNeighbours(ranked);
    });

    return () => {
      cancelled = true;
    };
  }, [index, selectedId, vector]);

  if (!item) return null;

  return (
    <aside
      className="flex flex-col gap-md rounded-md border border-line bg-surface p-md wide:sticky wide:top-md wide:max-h-panel-viewport wide:overflow-y-auto wide:overscroll-contain"
      aria-label="Similar photos"
    >
      <header className="flex items-center justify-between gap-xs">
        <h2 className="m-0 text-body font-semibold">Similar photos</h2>
        <button
          type="button"
          className="grid min-h-control min-w-control cursor-pointer place-items-center rounded-md border border-line bg-surface text-muted hover-safe:bg-sunken active:translate-y-px [&_svg]:size-ui"
          aria-label="Close the similar photos panel"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex items-center gap-sm border-b border-line pb-md">
        <img
          className="aspect-square h-auto w-thumb-lg rounded-sm bg-sunken object-cover"
          src={index.thumbUrl(item)}
          alt=""
          width={192}
          height={192}
          decoding="async"
        />
        <div className="flex min-w-0 items-center gap-xs">
          <span className="truncate text-sm font-semibold">{itemLabel(item)}</span>
          <AttributionPopover item={item} placement="inline" />
        </div>
      </div>

      {neighbours === null ? (
        <p className="m-0 text-sm text-muted">Ranking&hellip;</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-xs p-0">
          {neighbours.map((neighbour) => (
            <li key={neighbour.item.id}>
              <button
                type="button"
                className="grid-similar-row grid min-h-control w-full cursor-pointer items-center gap-xs rounded-sm border-0 bg-transparent p-3xs text-start hover-safe:bg-sunken active:bg-sunken"
                aria-label={`Show photos similar to ${itemLabel(neighbour.item)}`}
                onClick={() => ctx.onSelect(neighbour.item.id)}
              >
                <img
                  className="aspect-square h-auto w-thumb-sm rounded-sm bg-sunken object-cover"
                  src={index.thumbUrl(neighbour.item)}
                  alt=""
                  width={192}
                  height={192}
                  loading="lazy"
                  decoding="async"
                />
                <span className="flex min-w-0 flex-col gap-3xs">
                  <span className="truncate text-xs">{itemLabel(neighbour.item)}</span>
                  <ScoreBar score={neighbour.score} label={`Similarity to ${itemLabel(item)}`} />
                </span>
                <span className="text-end text-xs text-muted tabular-nums">
                  {formatScore(neighbour.score)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
