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
    <aside className="similar" aria-label="Similar photos">
      <header className="similar__header">
        <h2 className="similar__title">Similar photos</h2>
        <button
          type="button"
          className="similar__close"
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

      <div className="similar__query">
        <img
          className="similar__query-thumb"
          src={index.thumbUrl(item)}
          alt=""
          width={192}
          height={192}
          decoding="async"
        />
        <div className="similar__query-meta">
          <span className="similar__query-label">{itemLabel(item)}</span>
          <AttributionPopover item={item} />
        </div>
      </div>

      {neighbours === null ? (
        <p className="similar__note">Ranking&hellip;</p>
      ) : (
        <ol className="similar__list">
          {neighbours.map((neighbour) => (
            <li key={neighbour.item.id} className="similar__row">
              <button
                type="button"
                className="similar__row-hit"
                aria-label={`Show photos similar to ${itemLabel(neighbour.item)}`}
                onClick={() => ctx.onSelect(neighbour.item.id)}
              >
                <img
                  className="similar__thumb"
                  src={index.thumbUrl(neighbour.item)}
                  alt=""
                  width={192}
                  height={192}
                  loading="lazy"
                  decoding="async"
                />
                <span className="similar__row-body">
                  <span className="similar__row-label">{itemLabel(neighbour.item)}</span>
                  <ScoreBar score={neighbour.score} label={`Similarity to ${itemLabel(item)}`} />
                </span>
                <span className="similar__row-score">{formatScore(neighbour.score)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
