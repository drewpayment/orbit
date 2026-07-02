/**
 * Scoring math (Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * PURE functions only — no Payload imports here. The orchestration that reads
 * catalog-entities/entity-types/scorecard-rule-results and upserts
 * entity-scores rows (`recomputeWorkspaceScores`) lives in WP3
 * (lib/scorecards/evaluate.ts) and calls into these formulas. Keeping the math
 * pure makes it exhaustively unit-testable without a Payload instance.
 */

/** A single rule's contribution to a scorecard score: its weight and pass/fail. */
export interface WeightedRuleResult {
  weight: number
  passed: boolean
}

export interface ScorecardScoreResult {
  score: number
  passedRules: number
  totalRules: number
  weightedPoints: number
  maxPoints: number
}

/**
 * Per-scorecard score = round(100 × Σ(weight of passed rules) / Σ(weight of
 * all rules)). An empty rule set doesn't score — a scorecard with no rules
 * has nothing to compile into a number — so this returns `null` and the
 * orchestrator skips writing an entity-scores row for it.
 *
 * A rule's `weight` defaults to 1 when missing/non-positive-invalid (mirrors
 * the ScorecardRules.weight field's `defaultValue: 1`); weights of 0 count
 * toward neither the numerator nor denominator (a 0-weight rule is inert, not
 * a divide-by-zero risk).
 */
export function computeScorecardScore(rules: WeightedRuleResult[]): ScorecardScoreResult | null {
  if (rules.length === 0) return null

  let passedRules = 0
  let weightedPoints = 0
  let maxPoints = 0

  for (const rule of rules) {
    const weight = typeof rule.weight === 'number' && Number.isFinite(rule.weight) ? rule.weight : 1
    maxPoints += weight
    if (rule.passed) {
      passedRules++
      weightedPoints += weight
    }
  }

  // All rules weighted 0 -> nothing to divide by; treat as ungraded (null),
  // same as an empty rule set.
  if (maxPoints === 0) return null

  return {
    score: Math.round((100 * weightedPoints) / maxPoints),
    passedRules,
    totalRules: rules.length,
    weightedPoints,
    maxPoints,
  }
}

export interface OverallScoreInput {
  /** Per-scorecard scores (0-100) applying to the entity. */
  scorecardScores: number[]
  /** The entity type's inherited base value. */
  baseValue: number
}

/**
 * Overall score: no applicable scorecards -> the pure inherited `baseValue`.
 * Otherwise -> round(mean(scorecardScores)) — scorecards REPLACE the
 * baseline once standards exist to measure against; `baseValue` is still
 * carried on the entity-scores row for transparency, just not blended in.
 */
export function computeOverallScore({ scorecardScores, baseValue }: OverallScoreInput): number {
  if (scorecardScores.length === 0) return baseValue
  const mean = scorecardScores.reduce((sum, s) => sum + s, 0) / scorecardScores.length
  return Math.round(mean)
}

export interface GoldenPathAlignmentInput {
  /** Count of golden-path expectations (requiredRelations + requiredMetadata) met. */
  met: number
  /** Total count of golden-path expectations defined. */
  expected: number
}

/**
 * Golden-path alignment % = round(100 × met / expected) over a type
 * definition's `requiredRelations` + `requiredMetadata` checks. No
 * expectations defined -> 100 (nothing to fall short of, full marks).
 */
export function computeGoldenPathAlignment({ met, expected }: GoldenPathAlignmentInput): number {
  if (expected <= 0) return 100
  return Math.round((100 * met) / expected)
}
