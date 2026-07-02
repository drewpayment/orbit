import { describe, it, expect } from 'vitest'
import {
  computeScorecardScore,
  computeOverallScore,
  computeGoldenPathAlignment,
  type WeightedRuleResult,
} from './scoring'

// --- computeScorecardScore ---------------------------------------------------

describe('computeScorecardScore', () => {
  it('empty rule set -> null (a scorecard with no rules does not score)', () => {
    expect(computeScorecardScore([])).toBeNull()
  })

  it('all rules pass, equal weight -> 100', () => {
    const rules: WeightedRuleResult[] = [
      { weight: 1, passed: true },
      { weight: 1, passed: true },
    ]
    expect(computeScorecardScore(rules)).toEqual({
      score: 100,
      passedRules: 2,
      totalRules: 2,
      weightedPoints: 2,
      maxPoints: 2,
    })
  })

  it('all rules fail -> 0', () => {
    const rules: WeightedRuleResult[] = [
      { weight: 1, passed: false },
      { weight: 2, passed: false },
    ]
    expect(computeScorecardScore(rules)).toEqual({
      score: 0,
      passedRules: 0,
      totalRules: 2,
      weightedPoints: 0,
      maxPoints: 3,
    })
  })

  it('weighted mix: half the weight passes -> 50', () => {
    const rules: WeightedRuleResult[] = [
      { weight: 3, passed: true },
      { weight: 3, passed: false },
    ]
    expect(computeScorecardScore(rules)).toEqual({
      score: 50,
      passedRules: 1,
      totalRules: 2,
      weightedPoints: 3,
      maxPoints: 6,
    })
  })

  it('unequal weights: a heavier passed rule dominates the score', () => {
    const rules: WeightedRuleResult[] = [
      { weight: 9, passed: true },
      { weight: 1, passed: false },
    ]
    expect(computeScorecardScore(rules)?.score).toBe(90)
  })

  it('rounds to the nearest integer (not truncated)', () => {
    // 2 of 3 equal-weight rules passed -> 66.666...% -> rounds to 67.
    const rules: WeightedRuleResult[] = [
      { weight: 1, passed: true },
      { weight: 1, passed: true },
      { weight: 1, passed: false },
    ]
    expect(computeScorecardScore(rules)?.score).toBe(67)
  })

  it('missing/invalid weight defaults to 1', () => {
    const rules: WeightedRuleResult[] = [
      { weight: undefined as unknown as number, passed: true },
      { weight: Number.NaN, passed: false },
    ]
    const result = computeScorecardScore(rules)
    expect(result).toEqual({
      score: 50,
      passedRules: 1,
      totalRules: 2,
      weightedPoints: 1,
      maxPoints: 2,
    })
  })

  it('all rules weighted 0 -> null (nothing to divide by, same as empty)', () => {
    const rules: WeightedRuleResult[] = [
      { weight: 0, passed: true },
      { weight: 0, passed: false },
    ]
    expect(computeScorecardScore(rules)).toBeNull()
  })

  it('a 0-weight rule among weighted rules is inert (counted in neither numerator nor denominator)', () => {
    const rules: WeightedRuleResult[] = [
      { weight: 0, passed: false },
      { weight: 5, passed: true },
    ]
    expect(computeScorecardScore(rules)).toEqual({
      score: 100,
      passedRules: 1,
      totalRules: 2,
      weightedPoints: 5,
      maxPoints: 5,
    })
  })
})

// --- computeOverallScore ------------------------------------------------------

describe('computeOverallScore', () => {
  it('no applicable scorecards -> the pure inherited baseValue', () => {
    expect(computeOverallScore({ scorecardScores: [], baseValue: 50 })).toBe(50)
    expect(computeOverallScore({ scorecardScores: [], baseValue: 0 })).toBe(0)
    expect(computeOverallScore({ scorecardScores: [], baseValue: 100 })).toBe(100)
  })

  it('a single scorecard score replaces the baseline entirely', () => {
    expect(computeOverallScore({ scorecardScores: [80], baseValue: 50 })).toBe(80)
  })

  it('multiple scorecard scores -> rounded mean, baseValue ignored', () => {
    expect(computeOverallScore({ scorecardScores: [100, 0], baseValue: 50 })).toBe(50)
    expect(computeOverallScore({ scorecardScores: [90, 80, 70], baseValue: 50 })).toBe(80)
  })

  it('rounds the mean to the nearest integer', () => {
    // (100 + 0 + 0) / 3 = 33.33... -> rounds to 33.
    expect(computeOverallScore({ scorecardScores: [100, 0, 0], baseValue: 50 })).toBe(33)
    // (100 + 100 + 0) / 3 = 66.66... -> rounds to 67.
    expect(computeOverallScore({ scorecardScores: [100, 100, 0], baseValue: 50 })).toBe(67)
  })
})

// --- computeGoldenPathAlignment -----------------------------------------------

describe('computeGoldenPathAlignment', () => {
  it('no expectations defined -> 100', () => {
    expect(computeGoldenPathAlignment({ met: 0, expected: 0 })).toBe(100)
  })

  it('all expectations met -> 100', () => {
    expect(computeGoldenPathAlignment({ met: 4, expected: 4 })).toBe(100)
  })

  it('none met -> 0', () => {
    expect(computeGoldenPathAlignment({ met: 0, expected: 4 })).toBe(0)
  })

  it('partial alignment rounds to the nearest integer', () => {
    // 1 of 3 -> 33.33... -> 33.
    expect(computeGoldenPathAlignment({ met: 1, expected: 3 })).toBe(33)
    // 2 of 3 -> 66.66... -> 67.
    expect(computeGoldenPathAlignment({ met: 2, expected: 3 })).toBe(67)
  })

  it('a negative `expected` is treated as no expectations -> 100', () => {
    expect(computeGoldenPathAlignment({ met: 0, expected: -1 })).toBe(100)
  })
})
