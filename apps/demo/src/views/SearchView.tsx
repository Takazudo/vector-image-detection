import { useState, type FormEvent } from "react";
import { PhotoCard } from "../components/PhotoCard";
import {
  buttonClass,
  fieldInputClass,
  fieldLabelClass,
  growFieldClass,
  photoGridClass,
  toolbarClass,
  viewClass,
  viewErrorClass,
  viewHeaderClass,
  viewLedeClass,
  viewNoteClass,
  viewTitleClass,
} from "../components/ui";
import { canRequestEmbedding } from "../lib/embedder-client";
import { rankByVector, type RankedItem } from "../lib/search";
import type { DemoContext } from "../types";

const RESULT_LIMIT = 12;

export function SearchView({ ctx }: { ctx: DemoContext }) {
  const { index, tags, embedder } = ctx;
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [results, setResults] = useState<RankedItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Submitting is also the trigger that lazily starts the model load (see
  // EmbedderClient.embedTexts), so this only excludes mid-load and error —
  // "idle" stays submittable.
  const canSubmit = canRequestEmbedding(embedder.status);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (text.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    try {
      const [vector] = await embedder.embedTexts([text]);
      if (!vector) throw new Error("the embedder returned no vector for that query");
      setResults(await rankByVector(index.store, index.itemById, vector, RESULT_LIMIT));
      setSubmitted(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={viewClass}>
      <header className={viewHeaderClass}>
        <h2 className={viewTitleClass}>Search by description</h2>
        <p className={viewLedeClass}>
          The text is embedded into the same vector space as the photos, then ranked by cosine
          similarity. No keywords, no filenames, no tags are consulted.
        </p>
      </header>

      <form className={toolbarClass} onSubmit={onSubmit}>
        <div className={growFieldClass}>
          <label className={fieldLabelClass} htmlFor="search-query">
            Describe what you are looking for
          </label>
          <input
            id="search-query"
            className={fieldInputClass}
            type="search"
            value={query}
            placeholder="a photo of a cat"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className={buttonClass("primary")}
          disabled={busy || !canSubmit || query.trim().length === 0}
        >
          {busy ? "Embedding…" : "Search"}
        </button>
      </form>

      {embedder.status.phase === "loading" && (
        <p className={viewNoteClass}>Waiting for the text embedder to finish loading&hellip;</p>
      )}
      {error && <p className={viewErrorClass}>Search failed: {error}</p>}

      {results && (
        <>
          <p className={viewNoteClass}>
            Top {results.length} of {index.items.length} for <strong>{submitted}</strong>, best
            first. Scores are cosine similarities in this model&rsquo;s space — comparable within
            one query, not across models.
          </p>
          <div className={photoGridClass()}>
            {results.map((result) => (
              <PhotoCard
                key={result.item.id}
                item={result.item}
                thumbUrl={index.thumbUrl(result.item)}
                tags={tags.tagsById.get(result.item.id)}
                removableTags={tags.overlay[result.item.id]}
                score={result.score}
                selected={ctx.selectedId === result.item.id}
                onActivate={ctx.onSelect}
                onRemoveTag={tags.removeTag}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
