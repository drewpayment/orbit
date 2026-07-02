import { describe, it, expect } from 'vitest'
import {
  computeOrgKpis,
  computeScoreBands,
  computeGroupBreakdown,
  computeRuleFailures,
  buildTrendSeries,
  formatRelativeTime,
  type GroupScoreRow,
  type RuleResultRow,
  type SnapshotPoint,
} from './reporting'

// --- computeOrgKpis -----------------------------------------------------------

describe('computeOrgKpis', () => {
  it('no scored entities -> zeros, not NaN', () => {
    expect(computeOrgKpis([], [], 0)).toEqual({
      avgScore: 0,
      avgAlignment: 0,
      scoredCount: 0,
      entityTotal: 0,
    })
  })

  it('an empty workspace with entities but no scores yet -> zero averages, entityTotal carried through', () => {
    expect(computeOrgKpis([], [], 12)).toEqual({
      avgScore: 0,
      avgAlignment: 0,
      scoredCount: 0,
      entityTotal: 12,
    })
  })

  it('computes rounded mean score and mean alignment over scored entities', () => {
    expect(computeOrgKpis([80, 90, 70], [100, 50, 75], 5)).toEqual({
      avgScore: 80,
      avgAlignment: 75,
      scoredCount: 3,
      entityTotal: 5,
    })
  })

  it('rounds to the nearest integer (not truncated)', () => {
    // (80 + 81 + 81) / 3 = 80.666... -> rounds to 81.
    expect(computeOrgKpis([80, 81, 81], [], 3).avgScore).toBe(81)
  })

  it('scoredCount can be less than entityTotal (some entities not yet scored)', () => {
    const result = computeOrgKpis([100], [100], 4)
    expect(result.scoredCount).toBe(1)
    expect(result.entityTotal).toBe(4)
  })
})

// --- computeScoreBands ---------------------------------------------------------

describe('computeScoreBands', () => {
  it('empty input -> all four bands present with zero counts', () => {
    expect(computeScoreBands([])).toEqual([
      { label: '0-25', min: 0, max: 25, count: 0 },
      { label: '26-50', min: 26, max: 50, count: 0 },
      { label: '51-75', min: 51, max: 75, count: 0 },
      { label: '76-100', min: 76, max: 100, count: 0 },
    ])
  })

  it('places boundary scores in the correct band', () => {
    const bands = computeScoreBands([0, 25, 26, 50, 51, 75, 76, 100])
    expect(bands.map((b) => b.count)).toEqual([2, 2, 2, 2])
  })

  it('sums multiple scores landing in the same band', () => {
    const bands = computeScoreBands([10, 15, 20])
    expect(bands.find((b) => b.label === '0-25')?.count).toBe(3)
  })

  it('clamps an out-of-range negative score into the lowest band', () => {
    const bands = computeScoreBands([-10])
    expect(bands.find((b) => b.label === '0-25')?.count).toBe(1)
  })

  it('clamps an out-of-range score above 100 into the highest band', () => {
    const bands = computeScoreBands([150])
    expect(bands.find((b) => b.label === '76-100')?.count).toBe(1)
  })

  it('returns bands in fixed ascending order regardless of input order', () => {
    const bands = computeScoreBands([90, 10, 60, 30])
    expect(bands.map((b) => b.label)).toEqual(['0-25', '26-50', '51-75', '76-100'])
  })
})

// --- computeGroupBreakdown ------------------------------------------------------

describe('computeGroupBreakdown', () => {
  it('empty rows -> empty breakdown', () => {
    expect(computeGroupBreakdown([])).toEqual([])
  })

  it('single group: computes count, avg score, avg alignment, and worst entity', () => {
    const rows: GroupScoreRow[] = [
      { group: 'platform', entityId: 'e1', entityName: 'Service A', score: 80, alignment: 100 },
      { group: 'platform', entityId: 'e2', entityName: 'Service B', score: 40, alignment: 50 },
    ]
    expect(computeGroupBreakdown(rows)).toEqual([
      {
        group: 'platform',
        count: 2,
        avgScore: 60,
        avgAlignment: 75,
        worst: { id: 'e2', name: 'Service B', score: 40 },
      },
    ])
  })

  it('sorts groups ascending by avgScore -> worst group first', () => {
    const rows: GroupScoreRow[] = [
      { group: 'good-team', entityId: 'e1', entityName: 'A', score: 95, alignment: 100 },
      { group: 'bad-team', entityId: 'e2', entityName: 'B', score: 20, alignment: 30 },
      { group: 'mid-team', entityId: 'e3', entityName: 'C', score: 60, alignment: 60 },
    ]
    expect(computeGroupBreakdown(rows).map((g) => g.group)).toEqual([
      'bad-team',
      'mid-team',
      'good-team',
    ])
  })

  it('a tie for worst-in-group picks the first occurrence (stable, deterministic)', () => {
    const rows: GroupScoreRow[] = [
      { group: 'g', entityId: 'first', entityName: 'First', score: 30, alignment: 0 },
      { group: 'g', entityId: 'second', entityName: 'Second', score: 30, alignment: 0 },
    ]
    expect(computeGroupBreakdown(rows)[0].worst.id).toBe('first')
  })

  it('groups by the `group` key even when rows are interleaved in the input', () => {
    const rows: GroupScoreRow[] = [
      { group: 'a', entityId: '1', entityName: 'A1', score: 100, alignment: 100 },
      { group: 'b', entityId: '2', entityName: 'B1', score: 0, alignment: 0 },
      { group: 'a', entityId: '3', entityName: 'A2', score: 50, alignment: 50 },
    ]
    const breakdown = computeGroupBreakdown(rows)
    const groupA = breakdown.find((g) => g.group === 'a')
    expect(groupA).toEqual({
      group: 'a',
      count: 2,
      avgScore: 75,
      avgAlignment: 75,
      worst: { id: '3', name: 'A2', score: 50 },
    })
  })
})

// --- computeRuleFailures ---------------------------------------------------------

describe('computeRuleFailures', () => {
  it('empty input -> empty ranking', () => {
    expect(computeRuleFailures([])).toEqual([])
  })

  it('a rule that only ever passes is omitted (nothing to remediate)', () => {
    const results: RuleResultRow[] = [
      { ruleId: 'r1', title: 'Has owner', passed: true },
      { ruleId: 'r1', title: 'Has owner', passed: true },
    ]
    expect(computeRuleFailures(results)).toEqual([])
  })

  it('computes failCount and rounded failPct for a mixed rule', () => {
    const results: RuleResultRow[] = [
      { ruleId: 'r1', title: 'Has README', passed: true },
      { ruleId: 'r1', title: 'Has README', passed: false },
      { ruleId: 'r1', title: 'Has README', passed: false },
    ]
    // 2 of 3 failed -> 66.66...% -> rounds to 67.
    expect(computeRuleFailures(results)).toEqual([
      { ruleId: 'r1', title: 'Has README', failCount: 2, failPct: 67 },
    ])
  })

  it('ranks multiple rules by failCount descending', () => {
    const results: RuleResultRow[] = [
      { ruleId: 'low', title: 'Low', passed: false },
      { ruleId: 'high', title: 'High', passed: false },
      { ruleId: 'high', title: 'High', passed: false },
      { ruleId: 'high', title: 'High', passed: false },
    ]
    expect(computeRuleFailures(results).map((f) => f.ruleId)).toEqual(['high', 'low'])
  })

  it('breaks a failCount tie alphabetically by title for a stable order', () => {
    const results: RuleResultRow[] = [
      { ruleId: 'r-zebra', title: 'Zebra rule', passed: false },
      { ruleId: 'r-alpha', title: 'Alpha rule', passed: false },
    ]
    expect(computeRuleFailures(results).map((f) => f.title)).toEqual(['Alpha rule', 'Zebra rule'])
  })

  it('keeps the first-seen title for a rule id (rule titles do not change mid-report)', () => {
    const results: RuleResultRow[] = [
      { ruleId: 'r1', title: 'Original title', passed: false },
      { ruleId: 'r1', title: 'Should be ignored', passed: false },
    ]
    expect(computeRuleFailures(results)[0].title).toBe('Original title')
  })
})

// --- buildTrendSeries -------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-01T12:00:00.000Z')
const NOW_MS = NOW.getTime()

describe('buildTrendSeries', () => {
  it('empty snapshots -> empty series', () => {
    expect(buildTrendSeries([], 30, NOW)).toEqual([])
  })

  it('sorts snapshots ascending by capture time regardless of input order', () => {
    const snapshots: SnapshotPoint[] = [
      { capturedAt: new Date(NOW_MS - 1 * DAY_MS).toISOString(), avgScore: 70 },
      { capturedAt: new Date(NOW_MS - 3 * DAY_MS).toISOString(), avgScore: 50 },
      { capturedAt: new Date(NOW_MS - 2 * DAY_MS).toISOString(), avgScore: 60 },
    ]
    expect(buildTrendSeries(snapshots, 30, NOW).map((p) => p.v)).toEqual([50, 60, 70])
  })

  it('clips snapshots outside the trailing windowDays', () => {
    const snapshots: SnapshotPoint[] = [
      { capturedAt: new Date(NOW_MS - 5 * DAY_MS).toISOString(), avgScore: 40 }, // outside 3d window
      { capturedAt: new Date(NOW_MS - 1 * DAY_MS).toISOString(), avgScore: 80 }, // inside
    ]
    expect(buildTrendSeries(snapshots, 3, NOW)).toEqual([{ t: NOW_MS - 1 * DAY_MS, v: 80 }])
  })

  it('accepts Date objects as well as ISO strings for capturedAt', () => {
    const snapshots: SnapshotPoint[] = [{ capturedAt: new Date(NOW_MS - DAY_MS), avgScore: 55 }]
    expect(buildTrendSeries(snapshots, 7, NOW)).toEqual([{ t: NOW_MS - DAY_MS, v: 55 }])
  })

  it('excludes a snapshot captured after `now` (clock skew / bad data)', () => {
    const snapshots: SnapshotPoint[] = [
      { capturedAt: new Date(NOW_MS + DAY_MS).toISOString(), avgScore: 90 },
    ]
    expect(buildTrendSeries(snapshots, 30, NOW)).toEqual([])
  })

  it('drops a snapshot with an unparsable capturedAt', () => {
    const snapshots: SnapshotPoint[] = [{ capturedAt: 'not-a-date', avgScore: 90 }]
    expect(buildTrendSeries(snapshots, 30, NOW)).toEqual([])
  })

  it('accepts `now` as an epoch-ms number, not just a Date', () => {
    const snapshots: SnapshotPoint[] = [{ capturedAt: new Date(NOW_MS - DAY_MS).toISOString(), avgScore: 55 }]
    expect(buildTrendSeries(snapshots, 7, NOW_MS)).toEqual([{ t: NOW_MS - DAY_MS, v: 55 }])
  })

  it('a windowDays of 0 clips everything except a snapshot exactly at `now`', () => {
    const snapshots: SnapshotPoint[] = [
      { capturedAt: NOW.toISOString(), avgScore: 42 },
      { capturedAt: new Date(NOW_MS - 1).toISOString(), avgScore: 41 },
    ]
    expect(buildTrendSeries(snapshots, 0, NOW)).toEqual([{ t: NOW_MS, v: 42 }])
  })
})

// --- formatRelativeTime -------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('null/undefined -> em dash placeholder', () => {
    expect(formatRelativeTime(null, NOW)).toBe('—')
    expect(formatRelativeTime(undefined, NOW)).toBe('—')
  })

  it('an unparsable date string -> em dash placeholder', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('—')
  })

  it('under a minute -> "just now"', () => {
    expect(formatRelativeTime(new Date(NOW_MS - 30 * 1000), NOW)).toBe('just now')
  })

  it('a future timestamp (clock skew) -> "just now", not a negative duration', () => {
    expect(formatRelativeTime(new Date(NOW_MS + 60 * 1000), NOW)).toBe('just now')
  })

  it('minutes ago', () => {
    expect(formatRelativeTime(new Date(NOW_MS - 5 * 60 * 1000), NOW)).toBe('5m ago')
  })

  it('hours ago', () => {
    expect(formatRelativeTime(new Date(NOW_MS - 3 * 60 * 60 * 1000), NOW)).toBe('3h ago')
  })

  it('days ago (under a week)', () => {
    expect(formatRelativeTime(new Date(NOW_MS - 2 * DAY_MS), NOW)).toBe('2d ago')
  })

  it('falls back to a locale date at 7+ days', () => {
    const target = new Date(NOW_MS - 10 * DAY_MS)
    expect(formatRelativeTime(target, NOW)).toBe(target.toLocaleDateString())
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(formatRelativeTime(new Date(NOW_MS - 5 * 60 * 1000).toISOString(), NOW)).toBe('5m ago')
  })

  it('accepts `now` as an epoch-ms number, not just a Date', () => {
    expect(formatRelativeTime(new Date(NOW_MS - 5 * 60 * 1000), NOW_MS)).toBe('5m ago')
  })
})
