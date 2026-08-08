import type { labeling } from "../generated/core-browser.mjs";

export type ProposalDecision = "pending" | "confirmed" | "rejected";

export interface ProposalRow {
  id: string;
  score: number;
  decision: ProposalDecision;
}

/**
 * Every proposal starts pending: `proposeTagPropagation` deliberately returns
 * ranking scores rather than calibrated confidences, so there is no threshold
 * at which the app may auto-accept on the user's behalf.
 */
export function toProposalRows(proposals: readonly labeling.TagProposal[]): ProposalRow[] {
  return proposals.map((proposal) => ({ ...proposal, decision: "pending" as const }));
}

export function setDecision(
  rows: readonly ProposalRow[],
  id: string,
  decision: ProposalDecision,
): ProposalRow[] {
  return rows.map((row) => (row.id === id ? { ...row, decision } : row));
}

/** Applies a decision to the still-pending rows only, so a bulk action never overrides individual review. */
export function decidePending(
  rows: readonly ProposalRow[],
  decision: ProposalDecision,
): ProposalRow[] {
  return rows.map((row) => (row.decision === "pending" ? { ...row, decision } : row));
}

export function confirmedIds(rows: readonly ProposalRow[]): string[] {
  return rows.filter((row) => row.decision === "confirmed").map((row) => row.id);
}

export function countByDecision(rows: readonly ProposalRow[], decision: ProposalDecision): number {
  return rows.reduce((total, row) => total + (row.decision === decision ? 1 : 0), 0);
}
