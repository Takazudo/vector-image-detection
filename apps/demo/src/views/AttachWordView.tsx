import { labeling } from "../generated/core-browser.mjs";
import { useState } from "react";
import { PhotoCard } from "../components/PhotoCard";
import { ScoreBar } from "../components/ScoreBar";
import {
  buttonClass,
  fieldHintClass,
  fieldInputClass,
  fieldLabelClass,
  fieldRangeClass,
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
    // Changing the selection retires the attachment: step 2 never ran for the
    // photo just added, so propagating now would average it into the exemplar
    // mean for a word it does not carry. Tags already written stay written —
    // those were confirmed — but the word must be re-attached to continue.
    setAttachedWord(null);
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
    <section className={viewClass}>
      <header className={viewHeaderClass}>
        <h2 className={viewTitleClass}>Attach your own word</h2>
        <p className={viewLedeClass}>
          Pick one or more photos, give them a word of your own, then let the index propose which
          other photos deserve it. Nothing is written without your confirmation.
        </p>
      </header>

      <ol className="m-0 flex list-none flex-col gap-xl p-0">
        <li className="flex flex-col gap-sm">
          <h3 className="m-0 flex items-baseline gap-xs text-body font-semibold">
            1. Pick example photos
            <span className="text-xs font-medium text-muted">{exemplarIds.length} selected</span>
          </h3>
          <div className={photoGridClass(true)}>
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

        <li className="flex flex-col gap-sm">
          <h3 className="m-0 flex items-baseline gap-xs text-body font-semibold">
            2. Give them a word
          </h3>
          <div className={toolbarClass}>
            <div className={growFieldClass}>
              <label className={fieldLabelClass} htmlFor="attach-word">
                Your word
              </label>
              <input
                id="attach-word"
                className={fieldInputClass}
                type="text"
                value={word}
                placeholder="e.g. keeper, reshoot, needs-review"
                autoComplete="off"
                onChange={(event) => setWord(event.target.value)}
              />
              <p className={fieldHintClass}>
                It does not have to mean anything to the model — propagation works from the example
                photos&rsquo; vectors, not from the word.
              </p>
            </div>
            <button
              type="button"
              className={buttonClass("primary")}
              disabled={word.trim().length === 0 || exemplarIds.length === 0}
              onClick={attach}
            >
              Attach to selected
            </button>
          </div>
          {attachedWord && (
            <p className={viewNoteClass}>
              <strong>{attachedWord}</strong> is attached to {exemplarIds.length}{" "}
              {exemplarIds.length === 1 ? "photo" : "photos"}. It already shows in the gallery.
            </p>
          )}
        </li>

        <li className="flex flex-col gap-sm">
          <h3 className="m-0 flex items-baseline gap-xs text-body font-semibold">
            3. Propagate to similar photos
          </h3>
          <div className={toolbarClass}>
            <div className={growFieldClass}>
              <label className={fieldLabelClass} htmlFor="propagate-threshold">
                Similarity threshold: {threshold.toFixed(2)}
              </label>
              <input
                id="propagate-threshold"
                className={fieldRangeClass}
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
              className={buttonClass("primary")}
              disabled={busy || !attachedWord}
              onClick={() => void propagate()}
            >
              {busy ? "Searching…" : "Propagate"}
            </button>
          </div>

          {error && <p className={viewErrorClass}>Could not propose: {error}</p>}

          {rows && rows.length === 0 && (
            <p className={viewNoteClass}>
              No untagged photo is within {threshold.toFixed(2)} of the example set. Lower the
              threshold or add more examples.
            </p>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-sm">
                <p className={`${viewNoteClass} basis-store grow`}>
                  {rows.length} proposals — {confirmed} confirmed, {pending} still to review. Scores
                  rank similarity to the example set&rsquo;s mean vector; they are not confidences,
                  which is why nothing is accepted for you.
                </p>
                <button
                  type="button"
                  className={buttonClass("quiet")}
                  disabled={pending === 0}
                  onClick={confirmAllPending}
                >
                  Confirm all remaining
                </button>
                <button
                  type="button"
                  className={buttonClass("quiet")}
                  disabled={pending === 0}
                  onClick={() => setRows(decidePending(rows, "rejected"))}
                >
                  Reject all remaining
                </button>
              </div>

              <ul className="m-0 flex list-none flex-col gap-xs p-0">
                {rows.map((row) => {
                  const item = index.itemById.get(row.id);
                  if (!item) return null;
                  return (
                    <li
                      key={row.id}
                      className={`flex items-center gap-sm rounded-md border bg-surface p-xs ${row.decision === "rejected" ? "border-line opacity-50" : row.decision === "confirmed" ? "border-line-strong" : "border-line"}`}
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
                        <span className="text-sm font-semibold">{itemLabel(item)}</span>
                        <ScoreBar
                          score={row.score}
                          label={`Similarity to the example set for ${itemLabel(item)}`}
                        />
                      </div>
                      <div className="flex gap-3xs">
                        {row.decision === "pending" ? (
                          <>
                            <button
                              type="button"
                              className={buttonClass("confirm")}
                              onClick={() => confirmRow(row.id)}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className={buttonClass("reject")}
                              onClick={() => rejectRow(row.id)}
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="text-xs font-semibold capitalize text-muted">
                            {row.decision}
                          </span>
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
