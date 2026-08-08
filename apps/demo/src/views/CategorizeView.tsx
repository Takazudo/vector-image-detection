import type { IndexItem } from "@vector-image-detection/core/browser";
import { clustering, labeling } from "@vector-image-detection/core/browser";
import { useMemo, useState } from "react";
import { PhotoCard } from "../components/PhotoCard";
import { VocabularyField } from "../components/VocabularyField";
import { embedVocabInWorker } from "../lib/vocab-embedding";
import { DEFAULT_CATEGORY_VOCABULARY, parseVocabulary } from "../lib/vocabulary";
import type { DemoContext } from "../types";

interface LabelledGroup {
  label: string;
  entries: { item: IndexItem; score: number }[];
}

export function CategorizeView({ ctx }: { ctx: DemoContext }) {
  const { index, tags, embedder } = ctx;
  const [vocabInput, setVocabInput] = useState(DEFAULT_CATEGORY_VOCABULARY.join(", "));
  const [groups, setGroups] = useState<LabelledGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = useMemo(() => parseVocabulary(vocabInput), [vocabInput]);
  const modelReady = embedder.status.phase === "ready";

  async function classify() {
    if (labels.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // One text vector per label, reused across every image — embedVocab dedupes
      // and the result is only valid for this embedder + template pair.
      const vocabVectors = await embedVocabInWorker(labels, embedder.embedTexts);
      const winners = labeling.classifyByVocab(index.vectors, vocabVectors);

      const byLabel = new Map<string, LabelledGroup>(
        labels.map((label) => [label, { label, entries: [] }]),
      );
      winners.forEach((winner, i) => {
        byLabel.get(winner.label)?.entries.push({ item: index.items[i]!, score: winner.score });
      });
      for (const group of byLabel.values()) group.entries.sort((a, b) => b.score - a.score);
      setGroups([...byLabel.values()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setGroups(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view">
      <header className="view__header">
        <h2 className="view__title">Auto-categorize</h2>
        <p className="view__lede">
          Give the categories you care about as words. Each photo is assigned to the single closest
          one — no training, no labelled examples.
        </p>
      </header>

      <div className="toolbar">
        <VocabularyField
          id="categorize-vocab"
          label="Categories"
          value={vocabInput}
          hint="Comma-separated. Every photo lands in exactly one of these."
          onChange={setVocabInput}
        />
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !modelReady || labels.length === 0}
          onClick={() => void classify()}
        >
          {busy ? "Working…" : "Group by words"}
        </button>
      </div>

      {error && <p className="view__error">Could not categorize: {error}</p>}

      {groups?.map((group) => (
        <div key={group.label} className="group">
          <h3 className="group__title">
            {group.label}
            <span className="group__count">{group.entries.length}</span>
          </h3>
          {group.entries.length === 0 ? (
            <p className="view__empty">No photo is closest to this word.</p>
          ) : (
            <div className="photo-grid">
              {group.entries.map(({ item, score }) => (
                <PhotoCard
                  key={item.id}
                  item={item}
                  thumbUrl={index.thumbUrl(item)}
                  tags={tags.tagsById.get(item.id)}
                  removableTags={tags.overlay[item.id]}
                  score={score}
                  selected={ctx.selectedId === item.id}
                  onActivate={ctx.onSelect}
                  onRemoveTag={tags.removeTag}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      <DiscoverGroups ctx={ctx} />
    </section>
  );
}

const MIN_K = 2;
const MAX_K = 8;

function DiscoverGroups({ ctx }: { ctx: DemoContext }) {
  const { index, tags } = ctx;
  const maxK = Math.min(MAX_K, index.items.length - 1);
  const [k, setK] = useState(Math.min(4, Math.max(MIN_K, maxK)));
  const [open, setOpen] = useState(false);

  const clusters = useMemo(() => {
    if (!open || index.vectors.length < MIN_K) return null;
    const { assignments } = clustering.kmeans(index.vectors, Math.min(k, maxK));
    const buckets = new Map<number, IndexItem[]>();
    assignments.forEach((cluster, i) => {
      const bucket = buckets.get(cluster) ?? [];
      bucket.push(index.items[i]!);
      buckets.set(cluster, bucket);
    });
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  }, [open, index.vectors, index.items, k, maxK]);

  const suggested = useMemo(() => {
    if (!open || index.vectors.length < 3) return null;
    return clustering.suggestK(index.vectors, rangeOfK(maxK)).k;
  }, [open, index.vectors, maxK]);

  return (
    <details
      className="disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="disclosure__summary">Discover groups (exploratory)</summary>
      <p className="view__lede">
        k-means over the photo vectors, with no words involved. This is unsupervised — a cluster
        means &ldquo;these vectors are relatively close to each other&rdquo;, not &ldquo;these are
        the same kind of thing&rdquo;. With real photos, clusters often track colour, pose, or
        background rather than subject.
      </p>

      <div className="toolbar">
        <div className="field field--grow">
          <label className="field__label" htmlFor="cluster-k">
            Number of groups (k): {Math.min(k, maxK)}
          </label>
          <input
            id="cluster-k"
            className="field__range"
            type="range"
            min={MIN_K}
            max={Math.max(MIN_K, maxK)}
            step={1}
            value={Math.min(k, maxK)}
            onChange={(event) => setK(Number(event.target.value))}
          />
          {suggested !== null && (
            <p className="field__hint">
              Highest silhouette score in this range is k={suggested} — a heuristic for how many
              groups the data supports, not how many real categories exist.
            </p>
          )}
        </div>
        {suggested !== null && (
          <button type="button" className="button button--quiet" onClick={() => setK(suggested)}>
            Use k={suggested}
          </button>
        )}
      </div>

      {clusters?.map(([cluster, items]) => (
        <div key={cluster} className="group">
          <h3 className="group__title">
            Group {cluster + 1}
            <span className="group__count">{items.length}</span>
          </h3>
          <div className="photo-grid photo-grid--compact">
            {items.map((item) => (
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
        </div>
      ))}
    </details>
  );
}

function rangeOfK(maxK: number): number[] {
  const range: number[] = [];
  for (let k = MIN_K; k <= maxK; k++) range.push(k);
  return range;
}
