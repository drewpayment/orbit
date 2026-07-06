import { describe, expect, it } from 'vitest'
import {
  buildLevelDistribution,
  computeEntityLevel,
  formatPct,
  levelPresentation,
  passRatio,
  type LevelDef,
} from './scorecard-ui'

const LEVELS: LevelDef[] = [
  { name: 'Bronze', rank: 1, color: '#cd7f32' },
  { name: 'Silver', rank: 2 },
  { name: 'Gold', rank: 3 },
]

const RULES = [
  { id: 'b1', level: 'Bronze' },
  { id: 'b2', level: 'Bronze' },
  { id: 's1', level: 'Silver' },
  { id: 'g1', level: 'Gold' },
  { id: 'x', level: null }, // unattributed — must not affect the ladder
]

describe('computeEntityLevel', () => {
  it('returns null when a lowest-rung rule fails', () => {
    const passed = new Set(['b1', 's1', 'g1']) // b2 fails
    expect(computeEntityLevel(LEVELS, RULES, passed)).toBeNull()
  })

  it('stops at the first incomplete rung', () => {
    const passed = new Set(['b1', 'b2', 'g1']) // s1 fails -> Bronze only
    expect(computeEntityLevel(LEVELS, RULES, passed)?.name).toBe('Bronze')
  })

  it('awards the top rung when every ladder rule passes', () => {
    const passed = new Set(['b1', 'b2', 's1', 'g1'])
    expect(computeEntityLevel(LEVELS, RULES, passed)?.name).toBe('Gold')
  })

  it('treats a rung with no rules as satisfied', () => {
    const levels: LevelDef[] = [
      { name: 'Bronze', rank: 1 },
      { name: 'Empty', rank: 2 },
    ]
    const rules = [{ id: 'b1', level: 'Bronze' }]
    expect(computeEntityLevel(levels, rules, new Set(['b1']))?.name).toBe('Empty')
  })
})

describe('buildLevelDistribution', () => {
  it('buckets entities by level (highest first) and counts the unranked', () => {
    const gold = LEVELS[2]
    const bronze = LEVELS[0]
    const dist = buildLevelDistribution(LEVELS, [gold, bronze, bronze, null])

    expect(dist.buckets.map((b) => b.name)).toEqual(['Gold', 'Silver', 'Bronze'])
    expect(dist.buckets.find((b) => b.name === 'Gold')?.count).toBe(1)
    expect(dist.buckets.find((b) => b.name === 'Bronze')?.count).toBe(2)
    expect(dist.buckets.find((b) => b.name === 'Silver')?.count).toBe(0)
    expect(dist.unranked).toBe(1)
    expect(dist.total).toBe(4)
  })

  it('routes off-ladder levels into unranked', () => {
    const ghost: LevelDef = { name: 'Platinum', rank: 9 }
    const dist = buildLevelDistribution(LEVELS, [ghost])
    expect(dist.unranked).toBe(1)
  })
})

describe('passRatio / formatPct', () => {
  it('guards divide-by-zero', () => {
    expect(passRatio(0, 0)).toBe(0)
    expect(formatPct(passRatio(0, 0))).toBe('0%')
  })

  it('rounds to whole percent', () => {
    expect(formatPct(passRatio(2, 3))).toBe('67%')
  })
})

describe('levelPresentation', () => {
  it('surfaces a hex colour as a swatch', () => {
    const p = levelPresentation(LEVELS[0])
    expect(p.swatch).toBe('#cd7f32')
    expect(p.label).toBe('Bronze')
  })

  it('renders Unranked for a null level', () => {
    expect(levelPresentation(null).label).toBe('Unranked')
  })

  it('passes a non-hex colour through as a class token', () => {
    const p = levelPresentation({ name: 'Gold', rank: 3, color: 'bg-yellow-200' })
    expect(p.className).toBe('bg-yellow-200')
    expect(p.swatch).toBeUndefined()
  })
})
