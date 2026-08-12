import type { PhotoSummary } from "../worker/contracts/domain";

export function PhotoCard({
  photo,
  selected,
  disabled,
  onSelect,
  onRemoveTag,
  onShowRelated,
}: {
  photo: PhotoSummary;
  selected: boolean;
  disabled: boolean;
  onSelect(photoId: string): void;
  onRemoveTag(photoId: string, tag: string): void;
  onShowRelated(photo: PhotoSummary): void;
}) {
  return (
    <article
      className={`min-w-0 overflow-hidden rounded-lg border bg-surface ${selected ? "border-accent shadow-selected" : "border-line"}`}
    >
      <div className="relative aspect-[4/3] bg-sunken">
        <img
          className="h-full w-full object-cover"
          src={photo.mediaUrl}
          alt="Uploaded library photo"
          width={photo.width}
          height={photo.height}
          loading="lazy"
        />
        <label className="absolute top-xs left-xs flex min-h-control min-w-control cursor-pointer items-center justify-center rounded-md bg-surface/95 px-sm font-semibold shadow-sm">
          <input
            className="mr-xs size-md accent-accent"
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(photo.id)}
            aria-label={`Select photo ${photo.id}`}
          />
          Select
        </label>
      </div>
      <div className="grid gap-md p-md">
        <button
          type="button"
          className="min-h-control justify-self-start rounded-md border border-line-strong px-sm text-sm font-semibold hover-safe:bg-sunken"
          aria-label={`Show photos related to photo ${photo.id} by AI description`}
          onClick={() => onShowRelated(photo)}
        >
          Related by AI description
        </button>
        <div>
          <h3 className="m-0 text-sm font-semibold">AI suggested words</h3>
          <div className="mt-xs flex flex-wrap gap-xs" aria-label="AI suggested words">
            {photo.aiWords.length ? (
              photo.aiWords.map((word) => (
                <span
                  key={`${word.modelRunId}:${word.normalizedWord}`}
                  className="rounded-pill border border-ai-line bg-ai-soft px-sm py-3xs text-xs text-ai-ink"
                >
                  AI · {word.word}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted">No AI words yet</span>
            )}
          </div>
        </div>
        <div>
          <h3 className="m-0 text-sm font-semibold">Human tags</h3>
          <div className="mt-xs flex flex-wrap gap-xs" aria-label="Human tags">
            {photo.humanTags.length ? (
              photo.humanTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex min-h-control items-center rounded-pill border border-human-line bg-human-soft pl-sm text-xs text-human-ink"
                >
                  Human · {tag.name}
                  <button
                    type="button"
                    className="ml-3xs min-h-control min-w-control rounded-pill font-semibold disabled:cursor-not-allowed disabled:opacity-50 hover-safe:bg-surface focus-visible:outline-2"
                    disabled={disabled}
                    onClick={() => onRemoveTag(photo.id, tag.name)}
                    aria-label={`Remove human tag ${tag.name} from photo ${photo.id}`}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <span className="text-sm text-muted">No human tags</span>
            )}
          </div>
        </div>
        {photo.attribution && (
          <p className="m-0 text-xs text-muted">
            Source:{" "}
            {photo.attribution.sourceUrl ? (
              <a className="underline" href={photo.attribution.sourceUrl}>
                {photo.attribution.authorName ?? "original source"}
              </a>
            ) : (
              (photo.attribution.authorName ?? "seed collection")
            )}
            {photo.attribution.licenseName ? (
              <>
                {" "}
                ·{" "}
                {photo.attribution.licenseUrl ? (
                  <a className="underline" href={photo.attribution.licenseUrl}>
                    {photo.attribution.licenseName}
                  </a>
                ) : (
                  photo.attribution.licenseName
                )}
              </>
            ) : null}
          </p>
        )}
      </div>
    </article>
  );
}
