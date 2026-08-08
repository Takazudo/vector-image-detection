import { formatScore, scoreBarPercent } from "../lib/format";

export interface ScoreBarProps {
  score: number;
  /** Screen-reader description of what the score measures. */
  label: string;
}

/**
 * Neutral bar: the magnitude is carried by width, not hue, so a high similarity
 * never reads as "approved" and a low one never reads as "error". These are
 * ranking scores, not calibrated confidences.
 */
export function ScoreBar({ score, label }: ScoreBarProps) {
  const percent = scoreBarPercent(score);
  return (
    <span
      className="score-bar"
      role="img"
      aria-label={`${label}: ${formatScore(score)}`}
      title={formatScore(score)}
    >
      <span className="score-bar__fill" style={{ inlineSize: `${percent}%` }} />
    </span>
  );
}
