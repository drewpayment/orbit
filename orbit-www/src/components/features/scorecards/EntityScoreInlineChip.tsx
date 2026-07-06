import { ScoreNumberChip } from './ScoreChip'

/**
 * Overall-score chip for the catalog list (Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * Presentational only: `score` is supplied by the parent `EntityList`, which
 * fetches every listed entity's overall score in a single batched round-trip
 * (`getOverallEntityScores`) instead of each card self-fetching (the previous
 * per-scorecard-level design here was an N+1 — one `getEntityScoreSummary`
 * call per rendered card).
 */
export function EntityScoreInlineChip({
  score,
  baseline = false,
}: {
  score: number | null | undefined
  /** True when `score` is the entity type's inherited base value (no evaluation yet). */
  baseline?: boolean
}) {
  if (baseline && score != null) {
    // Inherited baseline: same numeric chip, muted and explained on hover, so
    // an un-evaluated entity's inherited value isn't mistaken for a measured
    // score at a glance.
    return (
      <span title="Inherited baseline from the entity type — not evaluated yet">
        <ScoreNumberChip score={score} className="opacity-70" />
      </span>
    )
  }
  return <ScoreNumberChip score={score} />
}
