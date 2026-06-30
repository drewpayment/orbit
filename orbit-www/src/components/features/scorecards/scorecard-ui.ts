/**
 * Pure presentation + aggregation helpers for the Scorecards UI (IDP refocus P2).
 *
 * Deliberately framework-light: no 'use server', no React, no Payload imports —
 * so both server actions and client components can import these. Keep all logic
 * here side-effect free and unit-testable (see scorecard-ui.test.ts).
 */

/** A maturity-ladder rung (mirrors Scorecards.levels[]). */
export interface LevelDef {
  name: string
  rank: number
  color?: string | null
}

/** Minimal rule shape needed to attribute it to a ladder rung. */
export interface RuleLite {
  id: string
  level?: string | null
}

/**
 * Compute the level an entity has achieved on a scorecard.
 *
 * Port-style ladder semantics: walk levels low→high; an entity holds a level
 * only when every rule on that rung *and* all lower rungs pass. The walk stops
 * at the first rung with a failing (or missing) rule. Rungs with no rules count
 * as automatically satisfied. Rules whose `level` matches no ladder rung do not
 * affect the level (but still count toward the pass ratio elsewhere).
 *
 * Returns the highest achieved level, or null when even the lowest rung fails.
 */
export function computeEntityLevel(
  levels: LevelDef[],
  rules: RuleLite[],
  passedRuleIds: Set<string>,
): LevelDef | null {
  const ladder = [...levels].sort((a, b) => a.rank - b.rank)
  let achieved: LevelDef | null = null

  for (const rung of ladder) {
    const rungRules = rules.filter((r) => r.level === rung.name)
    const allPass = rungRules.every((r) => passedRuleIds.has(r.id))
    if (!allPass) break
    achieved = rung
  }

  return achieved
}

/** One bucket in a per-scorecard level distribution. */
export interface LevelBucket extends LevelDef {
  count: number
}

export interface LevelDistribution {
  /** Buckets ordered highest rank first (most mature on the left). */
  buckets: LevelBucket[]
  /** Entities that achieved no ladder rung. */
  unranked: number
  /** Total entities considered. */
  total: number
}

/**
 * Aggregate a set of per-entity computed levels into a distribution over a
 * scorecard's ladder. Levels not present on the ladder fall into `unranked`.
 */
export function buildLevelDistribution(
  levels: LevelDef[],
  entityLevels: Array<LevelDef | null>,
): LevelDistribution {
  const buckets: LevelBucket[] = [...levels]
    .sort((a, b) => b.rank - a.rank)
    .map((l) => ({ ...l, count: 0 }))

  let unranked = 0
  for (const lvl of entityLevels) {
    if (!lvl) {
      unranked++
      continue
    }
    const bucket = buckets.find((b) => b.name === lvl.name)
    if (bucket) bucket.count++
    else unranked++
  }

  return { buckets, unranked, total: entityLevels.length }
}

/** Pass ratio in [0,1]; 0 when there is nothing to evaluate. */
export function passRatio(passed: number, total: number): number {
  return total <= 0 ? 0 : passed / total
}

/** Render a ratio (0..1) as a rounded whole-percent string. */
export function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Human labels for the three rule kinds. */
export const RULE_TYPE_LABEL: Record<string, string> = {
  'field-presence': 'Field presence',
  'relation-check': 'Relation check',
  threshold: 'Threshold',
}

export function ruleTypeLabel(type: string): string {
  return RULE_TYPE_LABEL[type] ?? type
}

/** Presentation for a level chip — a tailwind class set and optional hex swatch. */
export interface ChipPresentation {
  label: string
  className: string
  /** When the level defines a hex colour, the chip uses it as a leading swatch. */
  swatch?: string
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Map a level (or null) to chip presentation. A level may carry an explicit
 * `color`: a hex string is surfaced as a swatch, anything else is treated as a
 * tailwind class token. With no colour we fall back to a neutral primary tint.
 */
export function levelPresentation(level: LevelDef | null): ChipPresentation {
  if (!level) {
    return {
      label: 'Unranked',
      className: 'border-transparent bg-muted text-muted-foreground',
    }
  }

  const color = typeof level.color === 'string' ? level.color.trim() : ''
  if (color && HEX_RE.test(color)) {
    return { label: level.name, className: 'border-border bg-background text-foreground', swatch: color }
  }
  if (color) {
    return { label: level.name, className: color }
  }
  return { label: level.name, className: 'border-primary/20 bg-primary/10 text-primary' }
}

/** Tailwind text colour for a pass ratio, used by progress labels. */
export function passRatioTone(ratio: number): string {
  if (ratio >= 0.9) return 'text-emerald-600'
  if (ratio >= 0.6) return 'text-amber-600'
  return 'text-red-600'
}
