import { describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import type { LevelDef } from '@/components/features/scorecards/scorecard-ui'
import {
  average,
  aggregateOverallRows,
  aggregateScorecardRows,
  levelDistributionToJSON,
  isThrottled,
  captureScoreSnapshots,
  SNAPSHOT_THROTTLE_MS,
} from './snapshots'

// --- average -----------------------------------------------------------------

describe('average', () => {
  it('returns null for an empty list', () => {
    expect(average([])).toBeNull()
  })

  it('returns the mean of a non-empty list', () => {
    expect(average([10, 20, 30])).toBe(20)
  })

  it('does not round — callers round as needed', () => {
    expect(average([1, 2])).toBe(1.5)
  })
})

// --- aggregateOverallRows ------------------------------------------------------

describe('aggregateOverallRows', () => {
  it('returns null when there are no rows', () => {
    expect(aggregateOverallRows([])).toBeNull()
  })

  it('rounds the mean score and mean alignment, and reports the entity count', () => {
    const agg = aggregateOverallRows([
      { score: 80, goldenPathAlignment: 100 },
      { score: 81, goldenPathAlignment: 50 },
      { score: 82, goldenPathAlignment: 50 },
    ])
    expect(agg).toEqual({ avgScore: 81, avgAlignment: 67, entityCount: 3 })
  })

  it('avgAlignment is null when no row carries an alignment value', () => {
    const agg = aggregateOverallRows([{ score: 90 }, { score: 70 }])
    expect(agg).toEqual({ avgScore: 80, avgAlignment: null, entityCount: 2 })
  })

  it('ignores non-numeric alignment values when averaging alignment (but still counts every row)', () => {
    const agg = aggregateOverallRows([
      { score: 100, goldenPathAlignment: 100 },
      { score: 0, goldenPathAlignment: null },
    ])
    expect(agg).toEqual({ avgScore: 50, avgAlignment: 100, entityCount: 2 })
  })
})

// --- levelDistributionToJSON ---------------------------------------------------

const LEVELS: LevelDef[] = [
  { name: 'Bronze', rank: 1 },
  { name: 'Silver', rank: 2 },
  { name: 'Gold', rank: 3 },
]

describe('levelDistributionToJSON', () => {
  it('buckets entities by achieved level, plus an unranked bucket', () => {
    const json = levelDistributionToJSON(LEVELS, [
      { name: 'Gold', rank: 3 },
      { name: 'Bronze', rank: 1 },
      null,
      { name: 'Bronze', rank: 1 },
    ])
    expect(json).toEqual({ Bronze: 2, Silver: 0, Gold: 1, unranked: 1 })
  })

  it('an entity level not on the ladder falls into unranked, not a stray key', () => {
    const json = levelDistributionToJSON(LEVELS, [{ name: 'Platinum', rank: 4 }])
    expect(json).toEqual({ Bronze: 0, Silver: 0, Gold: 0, unranked: 1 })
  })

  it('no levels at all -> every entity is unranked', () => {
    const json = levelDistributionToJSON([], [{ name: 'Gold', rank: 3 }, null])
    expect(json).toEqual({ unranked: 2 })
  })
})

// --- aggregateScorecardRows -----------------------------------------------------

describe('aggregateScorecardRows', () => {
  it('returns null when there are no scored entities', () => {
    expect(aggregateScorecardRows([], [], LEVELS)).toBeNull()
  })

  it('computes avgScore, passRate, entityCount, and the level distribution together', () => {
    const agg = aggregateScorecardRows(
      [
        { score: 100, levelName: 'Gold', levelRank: 3 },
        { score: 40, levelName: 'Bronze', levelRank: 1 },
        { score: 0 }, // no level achieved
      ],
      [{ passed: true }, { passed: true }, { passed: false }, { passed: true }],
      LEVELS,
    )
    expect(agg).toEqual({
      avgScore: 47, // round((100+40+0)/3) = round(46.67)
      entityCount: 3,
      passRate: 0.75,
      levelDistribution: { Bronze: 1, Silver: 0, Gold: 1, unranked: 1 },
    })
  })

  it('passRate is null when there are no rule results yet (score rows can exist without them)', () => {
    const agg = aggregateScorecardRows([{ score: 50 }], [], LEVELS)
    expect(agg?.passRate).toBeNull()
  })

  it('a levelRank omitted alongside a levelName defaults to rank 0 without throwing', () => {
    const agg = aggregateScorecardRows([{ score: 10, levelName: 'Bronze' }], [], LEVELS)
    expect(agg?.levelDistribution).toEqual({ Bronze: 1, Silver: 0, Gold: 0, unranked: 0 })
  })
})

// --- isThrottled ---------------------------------------------------------------

describe('isThrottled', () => {
  const now = new Date('2026-07-01T12:00:00.000Z')

  it('is never throttled when there is no prior snapshot', () => {
    expect(isThrottled(null, now)).toBe(false)
    expect(isThrottled(undefined, now)).toBe(false)
  })

  it('is throttled just under the window', () => {
    const justUnder = new Date(now.getTime() - (SNAPSHOT_THROTTLE_MS - 1000)).toISOString()
    expect(isThrottled(justUnder, now)).toBe(true)
  })

  it('is not throttled once the window has fully elapsed', () => {
    const exactlyAt = new Date(now.getTime() - SNAPSHOT_THROTTLE_MS).toISOString()
    expect(isThrottled(exactlyAt, now)).toBe(false)
    const past = new Date(now.getTime() - SNAPSHOT_THROTTLE_MS - 1).toISOString()
    expect(isThrottled(past, now)).toBe(false)
  })
})

// --- captureScoreSnapshots (orchestration, FakePayload) -------------------------
//
// A minimal in-memory Payload stand-in mirroring the FakePayload pattern used
// by evaluate.test.ts's recomputeWorkspaceScores/runScorecardEvaluation suites
// — just enough `find`/`create` behavior for captureScoreSnapshots' queries.

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    'catalog-entities': [],
    'entity-scores': [],
    scorecards: [],
    'scorecard-rule-results': [],
    'score-snapshots': [],
  }
  private counter = 1

  private nextId(collection: string): string {
    return `${collection}-${this.counter++}`
  }

  async find({
    collection,
    where,
    sort,
    limit = 100,
  }: {
    collection: string
    where?: unknown
    sort?: string
    limit?: number
  }) {
    let all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    if (sort === '-capturedAt') {
      all = [...all].sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
    }
    // depth=1 population of `entity-scores.entity` for team-grouping — good
    // enough for these tests (entity docs are stored as full objects already).
    return { docs: all.slice(0, limit), hasNextPage: false }
  }

  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const doc = { id: this.nextId(collection), ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }
}

function matchesWhere(doc: Doc, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) return (w.and as unknown[]).every((clause) => matchesWhere(doc, clause))
  if (Array.isArray(w.or)) return (w.or as unknown[]).some((clause) => matchesWhere(doc, clause))

  for (const [field, condRaw] of Object.entries(w)) {
    const cond = condRaw as Record<string, unknown>
    const raw = doc[field]
    const actualId = raw && typeof raw === 'object' ? (raw as Doc).id : raw
    if ('equals' in cond) {
      if (actualId !== cond.equals) return false
    } else if ('in' in cond) {
      if (!(cond.in as unknown[]).includes(actualId)) return false
    }
  }
  return true
}

describe('captureScoreSnapshots', () => {
  it('appends a workspace-scope row aggregating every overall entity-scores row', async () => {
    const fp = new FakePayload()
    fp.collections['entity-scores'] = [
      { id: 'es1', workspace: 'ws1', entity: { id: 'e1' }, scope: 'overall', score: 80, goldenPathAlignment: 100 },
      { id: 'es2', workspace: 'ws1', entity: { id: 'e2' }, scope: 'overall', score: 60, goldenPathAlignment: 50 },
    ]

    const result = await captureScoreSnapshots(fp as unknown as Payload, 'ws1')

    expect(result).toEqual({ skipped: false, rowsWritten: 1 })
    const rows = fp.collections['score-snapshots']
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ workspace: 'ws1', scope: 'workspace', avgScore: 70, avgAlignment: 75, entityCount: 2 })
  })

  it('appends a scorecard-scope row per enabled scorecard, skipping disabled ones', async () => {
    const fp = new FakePayload()
    fp.collections['entity-scores'] = [
      { id: 'es1', workspace: 'ws1', entity: { id: 'e1' }, scope: 'overall', score: 80 },
      {
        id: 'es2',
        workspace: 'ws1',
        entity: { id: 'e1' },
        scope: 'scorecard',
        scorecard: 'sc1',
        score: 90,
        levelName: 'Gold',
        levelRank: 3,
      },
    ]
    fp.collections['scorecard-rule-results'] = [
      { id: 'r1', workspace: 'ws1', scorecard: 'sc1', passed: true },
      { id: 'r2', workspace: 'ws1', scorecard: 'sc1', passed: false },
    ]
    fp.collections['scorecards'] = [
      { id: 'sc1', workspace: 'ws1', enabled: true, levels: [{ name: 'Gold', rank: 3 }] },
      { id: 'sc2', workspace: 'ws1', enabled: false, levels: [] },
    ]

    const result = await captureScoreSnapshots(fp as unknown as Payload, 'ws1')

    expect(result.rowsWritten).toBe(2) // workspace + sc1 (sc2 disabled AND has no scored rows)
    const scRow = fp.collections['score-snapshots'].find((r) => r.scope === 'scorecard')
    expect(scRow).toMatchObject({
      scorecard: 'sc1',
      avgScore: 90,
      entityCount: 1,
      passRate: 0.5,
      levelDistribution: { Gold: 1, unranked: 0 },
    })
  })

  it('appends a team-scope row per owning team, grouping overall rows by entity.owner', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'team-a', workspace: 'ws1', kind: 'team' }]
    fp.collections['entity-scores'] = [
      { id: 'es1', workspace: 'ws1', entity: { id: 'e1', owner: 'team-a' }, scope: 'overall', score: 100 },
      { id: 'es2', workspace: 'ws1', entity: { id: 'e2', owner: 'team-a' }, scope: 'overall', score: 60 },
      { id: 'es3', workspace: 'ws1', entity: { id: 'e3' }, scope: 'overall', score: 0 }, // unowned -> excluded
    ]

    await captureScoreSnapshots(fp as unknown as Payload, 'ws1')

    const teamRow = fp.collections['score-snapshots'].find((r) => r.scope === 'team')
    expect(teamRow).toMatchObject({ team: 'team-a', avgScore: 80, entityCount: 2 })
  })

  it('a team with no scored entities gets no row (nothing to aggregate)', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'team-empty', workspace: 'ws1', kind: 'team' }]
    fp.collections['entity-scores'] = [{ id: 'es1', workspace: 'ws1', entity: { id: 'e1' }, scope: 'overall', score: 50 }]

    await captureScoreSnapshots(fp as unknown as Payload, 'ws1')

    expect(fp.collections['score-snapshots'].some((r) => r.scope === 'team')).toBe(false)
  })

  it('throttles a second capture within the window, and force bypasses it', async () => {
    const fp = new FakePayload()
    fp.collections['entity-scores'] = [{ id: 'es1', workspace: 'ws1', entity: { id: 'e1' }, scope: 'overall', score: 50 }]

    const first = await captureScoreSnapshots(fp as unknown as Payload, 'ws1')
    expect(first.skipped).toBe(false)

    const second = await captureScoreSnapshots(fp as unknown as Payload, 'ws1')
    expect(second).toEqual({ skipped: true, rowsWritten: 0 })
    expect(fp.collections['score-snapshots'].filter((r) => r.scope === 'workspace')).toHaveLength(1)

    const forced = await captureScoreSnapshots(fp as unknown as Payload, 'ws1', { force: true })
    expect(forced.skipped).toBe(false)
    expect(fp.collections['score-snapshots'].filter((r) => r.scope === 'workspace')).toHaveLength(2)
  })

  it('an empty workspace (no entity-scores at all) writes no rows but is not an error', async () => {
    const fp = new FakePayload()

    const result = await captureScoreSnapshots(fp as unknown as Payload, 'ws1')

    expect(result).toEqual({ skipped: false, rowsWritten: 0 })
    expect(fp.collections['score-snapshots']).toHaveLength(0)
  })
})
