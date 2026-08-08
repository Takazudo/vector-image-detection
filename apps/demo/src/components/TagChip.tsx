export interface TagChipProps {
  tag: string;
  score?: number;
  /** Omitted for tags that came from the index bundle — the demo only lets you remove what you added. */
  onRemove?: () => void;
}

export function TagChip({ tag, score, onRemove }: TagChipProps) {
  return (
    <span className="tag-chip">
      <span className="tag-chip__label">{tag}</span>
      {score !== undefined && <span className="tag-chip__score">{score.toFixed(2)}</span>}
      {onRemove && (
        <button
          type="button"
          className="tag-chip__remove"
          aria-label={`Remove tag ${tag}`}
          onClick={onRemove}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
