import { labeling } from "@vector-image-detection/core/browser";
import { useState } from "react";
import { PhotoCard } from "../components/PhotoCard";
import { ScoreBar } from "../components/ScoreBar";
import { itemLabel } from "../lib/format";
import {
  confirmedIds,
  countByDecision,
  decidePending,
  setDecision,
  toProposalRows,
  type ProposalRow,
} from "../lib/proposals";
import type { DemoContext } from "../types";

const PROPOSAL_LIMIT = 12;

export function AttachWordView({ ctx }: { ctx: DemoContext }) {
  const { index, tags } = ctx;
  const [exemplarIds, setExemplarIds] = useState<string[]>([]);
  const [word, setWord] = useState("");
  const [attachedWord, setAttachedWord] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.75);
  const [rows, setRows] = useState<ProposalRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleExemplar(id: string) {
    setExemplarIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
    setRows(null);
  }

  function attach() {
    const tag = word.trim();
    if (tag.length === 0 || exemplarIds.length === 0) return;
    tags.addTag(exemplarIds, tag);
    setAttachedWord(tag);
    setRows(null);
  }

  async function propagate() {
    if (!attachedWord || exemplarIds.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const proposals = await labeling.proposeTagPropagation(
        index.store,
        exemplarIds,
        attachedWord,
        { threshold, limit: PROPOSAL_LIMIT },
      );
      setRows(toProposalRows(proposals));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  function confirmRow(id: string) {
    if (!attachedWord) return;
    setRows((current) => (current ? setDecision(current, id, "confirmed") : current));
    tags.addTag([id], attachedWord);
  }

  function rejectRow(id: string) {
    setRows((current) => (current ? setDecision(current, id, "rejected") : current));
  }

  function confirmAllPending() {
    if (!attachedWord || !rows) return;
    const next = decidePending(rows, "confirmed");
    // Re-tagging rows confirmed earlier is a no-op, so the whole confirmed set
    // can go through one call rather than tracking a delta.
    tags.addTag(confirmedIds(next), attachedWord);
    setRows(next);
  }

  const pending = rows ? countByDecision(rows, "pending") : 0;
  const confirmed = rows ? countByDecision(rows, "confirmed") : 0;

  return (
    <section className="view">
      <header className="view__header">
        <h2 className="view__title">Attach your own word</h2>
        <p className="view__lede">
          Pick one or more photos, give them a word of your own, then let the index propose which
          other photos deserve it. Nothing is written without your confirmation.
        </p>
      </header>

      <ol className="steps">
        <li className="steps__step">
          <h3 className="steps__title">
            1. Pick example photos
            <span className="steps__count">{exemplarIds.length} selected</span>
          </h3>
          <div className="photo-grid photo-grid--compact">
            {index.items.map((item) => (
              <PhotoCard
                key={item.id}
                item={item}
                thumbUrl={index.thumbUrl(item)}
                tags={tags.tagsById.get(item.id)}
                removableTags={tags.overlay[item.id]}
                selected={exemplarIds.includes(item.id)}
                action="Use as an example:"
                onActivate={toggleExemplar}
                onRemoveTag={tags.removeTag}
              />
            ))}
          </div>
        </li>

        <li className="steps__step">
          <h3 className="steps__title">2. Give them a word</h3>
          <div className="toolbar">
            <div className="field field--grow">
              <label className="field__label" htmlFor="attach-word">
                Your word
              </label>
              <input
                id="attach-word"
                className="field__input"
                type="text"
                value={word}
                placeholder="e.g. keeper, reshoot, needs-review"
                autoComplete="off"
                onChange={(event) => setWord(event.target.value)}
              />
              <p className="field__hint">
                It does not have to mean anything to the model — propagation works from the example
                photos&rsquo; vectors, not from the word.
              </p>
            </div>
            <button
              type="button"
              className="button button--primary"
              disabled={word.trim().length === 0 || exemplarIds.length === 0}
              onClick={attach}
            >
              Attach to selected
            </button>
          </div>
          {attachedWord && (
            <p className="view__note">
              <strong>{attachedWord}</strong> is attached to {exemplarIds.length}{" "}
              {exemplarIds.length === 1 ? "photo" : "photos"}. It already shows in the gallery.
            </p>
          )}
        </li>

        <li className="steps__step">
          <h3 className="steps__title">3. Propagate to similar photos</h3>
          <div className="toolbar">
            <div className="field field--grow">
              <label className="field__label" htmlFor="propagate-threshold">
                Similarity threshold: {threshold.toFixed(2)}
              </label>
              <input
                id="propagate-threshold"
                className="field__range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
            </div>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !attachedWord}
              onClick={() => void propagate()}
            >
              {busy ? "Searching…" : "Propagate"}
            </button>
          </div>

          {error && <p className="view__error">Could not propose: {error}</p>}

          {rows && rows.length === 0 && (
            <p className="view__empty">
              No untagged photo is within {threshold.toFixed(2)} of the example set. Lower the
              threshold or add more examples.
            </p>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="proposal-toolbar">
                <p className="view__note">
                  {rows.length} proposals — {confirmed} confirmed, {pending} still to review. Scores
                  rank similarity to the example set&rsquo;s mean vector; they are not confidences,
                  which is why nothing is accepted for you.
                </p>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={pending === 0}
                  onClick={confirmAllPending}
                >
                  Confirm all remaining
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={pending === 0}
                  onClick={() => setRows(decidePending(rows, "rejected"))}
                >
                  Reject all remaining
                </button>
              </div>

              <ul className="proposals">
                {rows.map((row) => {
                  const item = index.itemById.get(row.id);
                  if (!item) return null;
                  return (
                    <li key={row.id} className={`proposals__row proposals__row--${row.decision}`}>
                      <img
                        className="proposals__thumb"
                        src={index.thumbUrl(item)}
                        alt=""
                        width={192}
                        height={192}
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="proposals__body">
                        <span className="proposals__label">{itemLabel(item)}</span>
                        <ScoreBar
                          score={row.score}
                          label={`Similarity to the example set for ${itemLabel(item)}`}
                        />
                      </div>
                      <div className="proposals__actions">
                        {row.decision === "pending" ? (
                          <>
                            <button
                              type="button"
                              className="button button--confirm"
                              onClick={() => confirmRow(row.id)}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="button button--reject"
                              onClick={() => rejectRow(row.id)}
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="proposals__decision">{row.decision}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </li>
      </ol>
    </section>
  );
}
