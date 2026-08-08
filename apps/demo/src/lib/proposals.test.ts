import { describe, expect, it } from "vitest";
import {
  confirmedIds,
  countByDecision,
  decidePending,
  setDecision,
  toProposalRows,
  type ProposalRow,
} from "./proposals";
import { addTag } from "./tags";

const PROPOSALS = [
  { id: "a", score: 0.98 },
  { id: "b", score: 0.91 },
  { id: "c", score: 0.83 },
];

describe("toProposalRows", () => {
  it("starts every proposal pending and preserves order and score", () => {
    expect(toProposalRows(PROPOSALS)).toEqual([
      { id: "a", score: 0.98, decision: "pending" },
      { id: "b", score: 0.91, decision: "pending" },
      { id: "c", score: 0.83, decision: "pending" },
    ]);
  });
});

describe("setDecision", () => {
  it("changes only the addressed row", () => {
    const rows = setDecision(toProposalRows(PROPOSALS), "b", "rejected");
    expect(rows.map((row) => row.decision)).toEqual(["pending", "rejected", "pending"]);
  });

  it("can flip an already-decided row back", () => {
    const rows = setDecision(
      setDecision(toProposalRows(PROPOSALS), "a", "confirmed"),
      "a",
      "pending",
    );
    expect(rows[0]!.decision).toBe("pending");
  });

  it("does not mutate the input rows", () => {
    const rows = toProposalRows(PROPOSALS);
    setDecision(rows, "a", "confirmed");
    expect(rows[0]!.decision).toBe("pending");
  });
});

describe("decidePending", () => {
  it("leaves already-decided rows alone", () => {
    const reviewed = setDecision(toProposalRows(PROPOSALS), "c", "rejected");
    const rows = decidePending(reviewed, "confirmed");
    expect(rows.map((row) => row.decision)).toEqual(["confirmed", "confirmed", "rejected"]);
  });
});

describe("confirmedIds / countByDecision", () => {
  const rows: ProposalRow[] = [
    { id: "a", score: 0.98, decision: "confirmed" },
    { id: "b", score: 0.91, decision: "rejected" },
    { id: "c", score: 0.83, decision: "pending" },
  ];

  it("reports only the confirmed ids", () => {
    expect(confirmedIds(rows)).toEqual(["a"]);
  });

  it("counts each decision", () => {
    expect(countByDecision(rows, "pending")).toBe(1);
    expect(countByDecision(rows, "confirmed")).toBe(1);
    expect(countByDecision(rows, "rejected")).toBe(1);
  });
});

// The confirm flow as AttachWordView performs it: mark rows, then write the
// confirmed ids into the tag overlay.
const confirmFlow = (
  overlay: Parameters<typeof addTag>[0],
  rows: readonly ProposalRow[],
  tag: string,
) => addTag(overlay, confirmedIds(rows), tag);

describe("confirm flow", () => {
  it("tags confirmed rows and ignores rejected and pending ones", () => {
    const rows = decidePending(
      setDecision(toProposalRows(PROPOSALS), "b", "rejected"),
      "confirmed",
    );
    expect(confirmFlow({}, rows, "kitten")).toEqual({ a: ["kitten"], c: ["kitten"] });
  });

  it("is idempotent — bulk-confirming again after a per-row confirm changes nothing", () => {
    const perRow = setDecision(toProposalRows(PROPOSALS), "a", "confirmed");
    const once = confirmFlow({}, perRow, "kitten");
    const bulk = decidePending(perRow, "confirmed");
    expect(confirmFlow(once, bulk, "kitten")).toEqual({
      a: ["kitten"],
      b: ["kitten"],
      c: ["kitten"],
    });
    expect(confirmFlow(confirmFlow(once, bulk, "kitten"), bulk, "kitten")).toEqual(
      confirmFlow(once, bulk, "kitten"),
    );
  });

  it("appends to tags an item already carries", () => {
    const rows = setDecision(toProposalRows(PROPOSALS), "a", "confirmed");
    expect(confirmFlow({ a: ["cat"] }, rows, "kitten")).toEqual({ a: ["cat", "kitten"] });
  });

  it("returns the overlay untouched when nothing was confirmed", () => {
    const overlay = { a: ["cat"] };
    const rows = decidePending(toProposalRows(PROPOSALS), "rejected");
    expect(confirmFlow(overlay, rows, "kitten")).toBe(overlay);
  });
});
