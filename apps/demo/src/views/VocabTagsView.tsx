import type { Vector } from "../generated/core-browser.mjs";
import { labeling } from "../generated/core-browser.mjs";
import { useMemo, useState } from "react";
import { AttributionPopover } from "../components/AttributionPopover";
import { ScoreBar } from "../components/ScoreBar";
import { TagChip } from "../components/TagChip";
import { VocabularyField } from "../components/VocabularyField";
import {
  buttonClass,
  fieldHintClass,
  fieldLabelClass,
  fieldRangeClass,
  growFieldClass,
  toolbarClass,
  viewClass,
  viewErrorClass,
  viewHeaderClass,
  viewLedeClass,
  viewNoteClass,
  viewTitleClass,
} from "../components/ui";
import { canRequestEmbedding } from "../lib/embedder-client";
import { embedderModeFor } from "../lib/embedder-protocol";
import { itemLabel } from "../lib/format";
import { embedVocabInWorker } from "../lib/vocab-embedding";
import { DEFAULT_TAG_VOCABULARY, parseVocabulary } from "../lib/vocabulary";
import type { DemoContext } from "../types";

export function VocabTagsView({ ctx }: { ctx: DemoContext }) {
  const { index, embedder } = ctx;
  const [vocabInput, setVocabInput] = useState(DEFAULT_TAG_VOCABULARY.join(", "));
  const [vocabVectors, setVocabVectors] = useState<Map<string, Vector> | null>(null);
  // A threshold is a per-dataset knob, and the two spaces are not comparable:
  // the fixture's fake space separates at ~0.99 vs ~0.3, while real SigLIP
  // similarities sit far lower — which is why core's own default is 0.2.
  // Starting each mode at a value that is sensible for it beats starting both
  // at one value that is wrong for one of them.
  const [threshold, setThreshold] = useState(
    embedderModeFor(index.meta.modelId) === "mock" ? 0.35 : 0.2,
  );
  const [showShare, setShowShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = useMemo(() => parseVocabulary(vocabInput), [vocabInput]);
  // Scoring is also the trigger that lazily starts the model load, so this
  // only excludes mid-load and error — "idle" stays submittable.
  const canSubmit = canRequestEmbedding(embedder.status);

  // Threshold moves are pure filtering over already-computed similarities, so
  // dragging the slider never re-embeds anything.
  const tagged = useMemo(() => {
    if (!vocabVectors) return null;
    return labeling.zeroShotTag(index.vectors, vocabVectors, { threshold });
  }, [index.vectors, vocabVectors, threshold]);

  const coverage = useMemo(() => {
    if (!tagged) return null;
    const withTags = tagged.filter((scores) => scores.length > 0).length;
    const total = tagged.reduce((sum, scores) => sum + scores.length, 0);
    return { withTags, total };
  }, [tagged]);

  async function embedVocabulary() {
    if (labels.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setVocabVectors(await embedVocabInWorker(labels, embedder.embedTexts));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setVocabVectors(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={viewClass}>
      <header className={viewHeaderClass}>
        <h2 className={viewTitleClass}>Vocabulary tags</h2>
        <p className={viewLedeClass}>
          Every word is scored against every photo, and each photo keeps the words that clear the
          threshold. Unlike auto-categorize, a photo can end up with none, one, or several.
        </p>
      </header>

      <div className={toolbarClass}>
        <VocabularyField
          id="tags-vocab"
          label="Vocabulary"
          value={vocabInput}
          hint="Comma-separated words to score against every photo."
          onChange={setVocabInput}
        />
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={busy || !canSubmit || labels.length === 0}
          onClick={() => void embedVocabulary()}
        >
          {busy ? "Embedding…" : "Score vocabulary"}
        </button>
      </div>

      {error && <p className={viewErrorClass}>Could not score the vocabulary: {error}</p>}

      {tagged && coverage && (
        <>
          <div className={toolbarClass}>
            <div className={growFieldClass}>
              <label className={fieldLabelClass} htmlFor="tag-threshold">
                Threshold: {threshold.toFixed(2)}
              </label>
              <input
                id="tag-threshold"
                className={fieldRangeClass}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <p className={fieldHintClass}>
                There is no universal right value — it is a per-dataset knob. Drag it and watch
                coverage trade off against precision.
              </p>
            </div>
            <label className="flex min-h-control items-center gap-2xs whitespace-nowrap text-sm text-muted [&_input]:accent-accent">
              <input
                type="checkbox"
                checked={showShare}
                onChange={(event) => setShowShare(event.target.checked)}
              />
              Show relative share
            </label>
          </div>

          <p className={viewNoteClass}>
            <strong>{coverage.withTags}</strong> of {index.items.length} photos tagged,{" "}
            <strong>{coverage.total}</strong> tags in total.
          </p>

          <ul className="m-0 flex list-none flex-col gap-xs p-0">
            {index.items.map((item, i) => {
              const scores = tagged[i] ?? [];
              const share = showShare ? labeling.softmaxOverVocab(scores) : [];
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-sm rounded-md border border-line bg-surface p-xs"
                >
                  <img
                    className="aspect-square h-auto w-thumb shrink-0 rounded-sm bg-sunken object-cover"
                    src={index.thumbUrl(item)}
                    alt=""
                    width={192}
                    height={192}
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-3xs">
                    <div className="flex items-center gap-xs">
                      <span className="text-sm font-semibold">{itemLabel(item)}</span>
                      <AttributionPopover item={item} placement="inline" />
                    </div>
                    {scores.length === 0 ? (
                      <p className="m-0 text-xs text-subtle">No word clears the threshold.</p>
                    ) : (
                      <ul className="m-0 flex list-none flex-wrap gap-3xs p-0">
                        {scores.map((score) => (
                          <li key={score.label}>
                            <TagChip tag={score.label} score={score.score} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {showShare && share.length > 0 && (
                      <div className="mt-3xs flex flex-col gap-3xs">
                        <p className="m-0 text-2xs text-subtle">
                          Relative share across the words that cleared the threshold — a display
                          normalization, not a probability or a confidence.
                        </p>
                        {share.map((entry) => (
                          <div
                            key={entry.label}
                            className="grid-share grid items-center gap-xs text-xs"
                          >
                            <span className="truncate text-muted">{entry.label}</span>
                            <ScoreBar score={entry.score} label={`Share for ${entry.label}`} />
                            <span className="text-end text-muted tabular-nums">
                              {Math.round(entry.score * 100)}&#37;
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
