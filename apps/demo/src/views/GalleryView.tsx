import { useMemo, useState } from "react";
import { PhotoCard } from "../components/PhotoCard";
import {
  photoGridClass,
  pillClass,
  viewClass,
  viewHeaderClass,
  viewLedeClass,
  viewNoteClass,
  viewTitleClass,
} from "../components/ui";
import type { DemoContext } from "../types";

export function GalleryView({ ctx }: { ctx: DemoContext }) {
  const { index, tags } = ctx;
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const list of tags.tagsById.values()) {
      for (const tag of list) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tags.tagsById]);

  const visible = useMemo(
    () =>
      tagFilter === null
        ? index.items
        : index.items.filter((item) => tags.tagsById.get(item.id)?.includes(tagFilter)),
    [index.items, tags.tagsById, tagFilter],
  );

  return (
    <section className={viewClass}>
      <header className={viewHeaderClass}>
        <h2 className={viewTitleClass}>Gallery</h2>
        <p className={viewLedeClass}>
          {index.items.length} photos from the index bundle. Click any photo to see its nearest
          neighbours; the info icon shows the credit fields the bundle carries.
        </p>
      </header>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-xs">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Filter by tag
          </span>
          <button
            type="button"
            className={pillClass(tagFilter === null)}
            onClick={() => setTagFilter(null)}
          >
            All
          </button>
          {allTags.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              className={pillClass(tagFilter === tag)}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            >
              {tag} <span className="text-subtle tabular-nums">{count}</span>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className={viewNoteClass}>No photos carry that tag.</p>
      ) : (
        <div className={photoGridClass()}>
          {visible.map((item) => (
            <PhotoCard
              key={item.id}
              item={item}
              thumbUrl={index.thumbUrl(item)}
              tags={tags.tagsById.get(item.id)}
              removableTags={tags.overlay[item.id]}
              selected={ctx.selectedId === item.id}
              onActivate={ctx.onSelect}
              onRemoveTag={tags.removeTag}
            />
          ))}
        </div>
      )}
    </section>
  );
}
