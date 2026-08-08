export interface TagChipProps {
  tag: string;
  score?: number;
  /** Omitted for tags that came from the index bundle — the demo only lets you remove what you added. */
  onRemove?: () => void;
}

export function TagChip({ tag, score, onRemove }: TagChipProps) {
  return (
    <span className="inline-flex items-center gap-3xs rounded-sm bg-sunken py-3xs ps-2xs pe-3xs text-xs text-ink">
      <span>{tag}</span>
      {score !== undefined && <span className="text-subtle tabular-nums">{score.toFixed(2)}</span>}
      {onRemove && (
        <button
          type="button"
          className="grid min-h-control min-w-control cursor-pointer place-items-center border-0 bg-transparent p-0 text-subtle hover-safe:text-danger active:text-danger [&_svg]:size-sm"
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
