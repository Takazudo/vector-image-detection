import { useState, type FormEvent } from "react";
import { PhotoCard } from "../components/PhotoCard";
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

  const modelReady = embedder.status.phase === "ready";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (text.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    try {
      const [vector] = await embedder.embedTexts([text]);
      setResults(await rankByVector(index.store, index.itemById, vector!, RESULT_LIMIT));
      setSubmitted(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view">
      <header className="view__header">
        <h2 className="view__title">Search by description</h2>
        <p className="view__lede">
          The text is embedded into the same vector space as the photos, then ranked by cosine
          similarity. No keywords, no filenames, no tags are consulted.
        </p>
      </header>

      <form className="toolbar" onSubmit={onSubmit}>
        <div className="field field--grow">
          <label className="field__label" htmlFor="search-query">
            Describe what you are looking for
          </label>
          <input
            id="search-query"
            className="field__input"
            type="search"
            value={query}
            placeholder="a photo of a cat"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || !modelReady || query.trim().length === 0}
        >
          {busy ? "Embedding…" : "Search"}
        </button>
      </form>

      {!modelReady && embedder.status.phase === "loading" && (
        <p className="view__note">Waiting for the text embedder to finish loading&hellip;</p>
      )}
      {error && <p className="view__error">Search failed: {error}</p>}

      {results && (
        <>
          <p className="view__note">
            Top {results.length} of {index.items.length} for <strong>{submitted}</strong>, best
            first. Scores are cosine similarities in this model&rsquo;s space — comparable within
            one query, not across models.
          </p>
          <div className="photo-grid">
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
