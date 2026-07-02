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
export function EntityScoreInlineChip({ score }: { score: number | null | undefined }) {
  return <ScoreNumberChip score={score} />
}
