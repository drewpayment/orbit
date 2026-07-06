import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import type { InitiativeActionItem, ScorecardRuleResult } from '@/payload-types'
import type { LevelDef } from '@/components/features/scorecards/scorecard-ui'
import { runScorecardEvaluation } from './evaluate'
import {
  computeTargetRank,
  selectInScopeRules,
  computeFailingPairs,
  diffActionItems,
  computeInitiativeProgress,
  latestRuleResults,
  appendNote,
  toActionItemLite,
  syncInitiativeActionItems,
  isActiveWorkspaceMember,
  assertAssigneeInWorkspace,
  AUTO_COMPLETE_NOTE,
  REOPEN_NOTE,
  type ActionItemLite,
  type FailingPair,
  type RuleLite,
} from './initiatives'

const LEVELS: LevelDef[] = [
  { name: 'Bronze', rank: 1 },
  { name: 'Silver', rank: 2 },
  { name: 'Gold', rank: 3 },
]

// --- computeTargetRank -------------------------------------------------------

describe('computeTargetRank', () => {
  it('returns the rank of a known level name', () => {
    expect(computeTargetRank(LEVELS, 'Silver')).toBe(2)
  })
  it('returns null for an unknown level name', () => {
    expect(computeTargetRank(LEVELS, 'Platinum')).toBeNull()
  })
  it('returns null when the target is absent', () => {
    expect(computeTargetRank(LEVELS, null)).toBeNull()
    expect(computeTargetRank(LEVELS, undefined)).toBeNull()
    expect(computeTargetRank(LEVELS, '')).toBeNull()
  })
})

// --- selectInScopeRules ------------------------------------------------------

describe('selectInScopeRules', () => {
  const rules: RuleLite[] = [
    { id: 'base', level: null }, // level-less base rule
    { id: 'bronze', level: 'Bronze' },
    { id: 'silver', level: 'Silver' },
    { id: 'gold', level: 'Gold' },
    { id: 'ghost', level: 'Platinum' }, // off-ladder level
  ]

  it('includes level-less rules plus leveled rules with rank <= target rank', () => {
    const ids = selectInScopeRules(rules, LEVELS, 'Silver').map((r) => r.id)
    expect(ids.sort()).toEqual(['base', 'bronze', 'silver'])
  })

  it('at the top target, includes every on-ladder leveled rule plus base', () => {
    const ids = selectInScopeRules(rules, LEVELS, 'Gold').map((r) => r.id)
    expect(ids.sort()).toEqual(['base', 'bronze', 'gold', 'silver'])
  })

  it('excludes rules tagged with a level not on the ladder (gates no rung)', () => {
    const ids = selectInScopeRules(rules, LEVELS, 'Gold').map((r) => r.id)
    expect(ids).not.toContain('ghost')
  })

  it('with a null/unknown target rank, only level-less base rules are in scope', () => {
    expect(selectInScopeRules(rules, LEVELS, 'Platinum').map((r) => r.id)).toEqual(['base'])
    expect(selectInScopeRules(rules, LEVELS, null).map((r) => r.id)).toEqual(['base'])
  })
})

// --- computeFailingPairs -----------------------------------------------------

describe('computeFailingPairs', () => {
  const rules: RuleLite[] = [
    { id: 'base', level: null },
    { id: 'bronze', level: 'Bronze' },
    { id: 'gold', level: 'Gold' },
  ]

  it('emits a pair for every failing latest result on an in-scope rule', () => {
    const results = [
      { ruleId: 'base', entityId: 'e1', passed: false },
      { ruleId: 'bronze', entityId: 'e1', passed: false },
      { ruleId: 'base', entityId: 'e2', passed: true }, // passing → excluded
    ]
    const pairs = computeFailingPairs(rules, results, LEVELS, 'Bronze')
    expect(pairs).toEqual([
      { entityId: 'e1', ruleId: 'base' },
      { entityId: 'e1', ruleId: 'bronze' },
    ])
  })

  it('excludes failing results for out-of-scope (above-target) rules', () => {
    const results = [
      { ruleId: 'bronze', entityId: 'e1', passed: false },
      { ruleId: 'gold', entityId: 'e1', passed: false }, // above Bronze target
    ]
    const pairs = computeFailingPairs(rules, results, LEVELS, 'Bronze')
    expect(pairs).toEqual([{ entityId: 'e1', ruleId: 'bronze' }])
  })
})

// --- diffActionItems ---------------------------------------------------------

function item(partial: Partial<ActionItemLite> & { id: string }): ActionItemLite {
  return {
    entityId: partial.entityId ?? 'e1',
    ruleId: partial.ruleId ?? 'r1',
    status: partial.status ?? 'open',
    notes: partial.notes ?? null,
    ...partial,
  }
}

describe('diffActionItems', () => {
  it('creates an item for a failing pair with no existing item', () => {
    const failing: FailingPair[] = [{ entityId: 'e1', ruleId: 'r1' }]
    const diff = diffActionItems([], failing)
    expect(diff.toCreate).toEqual(failing)
    expect(diff.toComplete).toEqual([])
    expect(diff.toReopen).toEqual([])
  })

  it('leaves an open item whose pair is still failing untouched', () => {
    const existing = [item({ id: 'a', status: 'open' })]
    const diff = diffActionItems(existing, [{ entityId: 'e1', ruleId: 'r1' }])
    expect(diff).toEqual({ toCreate: [], toComplete: [], toReopen: [] })
  })

  it('auto-completes an open item whose pair now passes (not in failing set)', () => {
    const existing = [item({ id: 'a', status: 'open' })]
    const diff = diffActionItems(existing, [])
    expect(diff.toComplete.map((i) => i.id)).toEqual(['a'])
    expect(diff.toCreate).toEqual([])
    expect(diff.toReopen).toEqual([])
  })

  it('auto-completes an in-progress item whose pair left scope', () => {
    const existing = [item({ id: 'a', status: 'in-progress' })]
    const diff = diffActionItems(existing, [])
    expect(diff.toComplete.map((i) => i.id)).toEqual(['a'])
  })

  it('reopens a done item whose pair fails again', () => {
    const existing = [item({ id: 'a', status: 'done' })]
    const diff = diffActionItems(existing, [{ entityId: 'e1', ruleId: 'r1' }])
    expect(diff.toReopen.map((i) => i.id)).toEqual(['a'])
    expect(diff.toComplete).toEqual([])
    expect(diff.toCreate).toEqual([])
  })

  it('leaves a done item whose pair still passes untouched', () => {
    const existing = [item({ id: 'a', status: 'done' })]
    const diff = diffActionItems(existing, [])
    expect(diff).toEqual({ toCreate: [], toComplete: [], toReopen: [] })
  })

  it('never touches a waived item — pair passing', () => {
    const existing = [item({ id: 'a', status: 'waived' })]
    const diff = diffActionItems(existing, [])
    expect(diff).toEqual({ toCreate: [], toComplete: [], toReopen: [] })
  })

  it('never touches a waived item — pair failing (no reopen, no duplicate create)', () => {
    const existing = [item({ id: 'a', status: 'waived' })]
    const diff = diffActionItems(existing, [{ entityId: 'e1', ruleId: 'r1' }])
    // waived counts as an existing item for this pair → no create, no reopen.
    expect(diff).toEqual({ toCreate: [], toComplete: [], toReopen: [] })
  })

  it('ignores items with no rule id (manual, not sync-managed)', () => {
    const existing = [item({ id: 'a', ruleId: null, status: 'open' })]
    const diff = diffActionItems(existing, [])
    expect(diff).toEqual({ toCreate: [], toComplete: [], toReopen: [] })
  })

  it('dedupes repeated failing pairs into a single create', () => {
    const failing: FailingPair[] = [
      { entityId: 'e1', ruleId: 'r1' },
      { entityId: 'e1', ruleId: 'r1' },
    ]
    const diff = diffActionItems([], failing)
    expect(diff.toCreate).toEqual([{ entityId: 'e1', ruleId: 'r1' }])
  })

  it('handles a mixed batch across entities and rules', () => {
    const existing = [
      item({ id: 'keep', entityId: 'e1', ruleId: 'r1', status: 'open' }), // still failing
      item({ id: 'complete', entityId: 'e1', ruleId: 'r2', status: 'in-progress' }), // now passing
      item({ id: 'reopen', entityId: 'e2', ruleId: 'r1', status: 'done' }), // fails again
      item({ id: 'waived', entityId: 'e2', ruleId: 'r2', status: 'waived' }), // immune
    ]
    const failing: FailingPair[] = [
      { entityId: 'e1', ruleId: 'r1' }, // keep
      { entityId: 'e2', ruleId: 'r1' }, // reopen
      { entityId: 'e3', ruleId: 'r1' }, // new create
    ]
    const diff = diffActionItems(existing, failing)
    expect(diff.toCreate).toEqual([{ entityId: 'e3', ruleId: 'r1' }])
    expect(diff.toComplete.map((i) => i.id)).toEqual(['complete'])
    expect(diff.toReopen.map((i) => i.id)).toEqual(['reopen'])
  })
})

// --- computeInitiativeProgress ----------------------------------------------

describe('computeInitiativeProgress', () => {
  it('is 100% complete for an empty item list', () => {
    expect(computeInitiativeProgress([])).toEqual({
      total: 0,
      open: 0,
      inProgress: 0,
      done: 0,
      waived: 0,
      pctComplete: 100,
    })
  })

  it('counts each status and computes (done + waived) / total', () => {
    const progress = computeInitiativeProgress([
      { status: 'open' },
      { status: 'in-progress' },
      { status: 'done' },
      { status: 'waived' },
    ])
    expect(progress).toEqual({
      total: 4,
      open: 1,
      inProgress: 1,
      done: 1,
      waived: 1,
      pctComplete: 50,
    })
  })

  it('treats waived as counting toward completion (all waived → 100%)', () => {
    expect(computeInitiativeProgress([{ status: 'waived' }, { status: 'waived' }]).pctComplete).toBe(100)
  })

  it('rounds the percentage', () => {
    // 1 of 3 complete → round(33.33) = 33
    expect(computeInitiativeProgress([{ status: 'done' }, { status: 'open' }, { status: 'open' }]).pctComplete).toBe(33)
    // 2 of 3 complete → round(66.67) = 67
    expect(computeInitiativeProgress([{ status: 'done' }, { status: 'done' }, { status: 'open' }]).pctComplete).toBe(67)
  })
})

// --- latestRuleResults / appendNote / toActionItemLite ----------------------

describe('latestRuleResults', () => {
  it('reduces to one lite result per (rule, entity), newest evaluatedAt wins', () => {
    const rows = [
      { rule: 'r1', entity: 'e1', passed: false, evaluatedAt: '2026-07-01T00:00:00.000Z' },
      { rule: 'r1', entity: 'e1', passed: true, evaluatedAt: '2026-07-02T00:00:00.000Z' },
      { rule: 'r2', entity: 'e1', passed: false, evaluatedAt: '2026-07-01T00:00:00.000Z' },
    ] as unknown as ScorecardRuleResult[]
    const latest = latestRuleResults(rows)
    expect(latest).toContainEqual({ ruleId: 'r1', entityId: 'e1', passed: true })
    expect(latest).toContainEqual({ ruleId: 'r2', entityId: 'e1', passed: false })
    expect(latest).toHaveLength(2)
  })

  it('normalises populated relationship ends to their ids', () => {
    const rows = [
      { rule: { id: 'r1' }, entity: { id: 'e1' }, passed: false, evaluatedAt: '2026-07-01T00:00:00.000Z' },
    ] as unknown as ScorecardRuleResult[]
    expect(latestRuleResults(rows)).toEqual([{ ruleId: 'r1', entityId: 'e1', passed: false }])
  })
})

describe('appendNote', () => {
  it('returns the line alone when there are no existing notes', () => {
    expect(appendNote(null, 'hello')).toBe('hello')
    expect(appendNote('', 'hello')).toBe('hello')
    expect(appendNote('   ', 'hello')).toBe('hello')
  })
  it('appends on a fresh line, preserving prior content', () => {
    expect(appendNote('first', 'second')).toBe('first\nsecond')
  })
})

describe('toActionItemLite', () => {
  it('maps a persisted row to the lite shape, defaulting status to open', () => {
    const row = {
      id: 'a',
      entity: { id: 'e1' },
      rule: 'r1',
      status: null,
      notes: 'x',
    } as unknown as InitiativeActionItem
    expect(toActionItemLite(row)).toEqual({ id: 'a', entityId: 'e1', ruleId: 'r1', status: 'open', notes: 'x' })
  })
})

// --- FakePayload (sync wrapper + evaluation-hook integration) ----------------
//
// Mirrors evaluate.test.ts's in-memory Payload stand-in, extended with the
// initiatives / initiative-action-items collections this module reads/writes.

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    'catalog-entities': [],
    'catalog-relations': [],
    scorecards: [],
    'scorecard-rules': [],
    'scorecard-rule-results': [],
    'entity-scores': [],
    'entity-types': [],
    initiatives: [],
    'initiative-action-items': [],
    'score-snapshots': [],
    'workspace-members': [],
  }
  private counter = 1
  /** Collections whose writes should throw (to exercise failure paths). */
  throwOnWrite = new Set<string>()

  private nextId(collection: string): string {
    return `${collection}-${this.counter++}`
  }

  async find({
    collection,
    where,
    limit = 100,
    page = 1,
    depth = 0,
  }: {
    collection: string
    where?: unknown
    limit?: number
    page?: number
    depth?: number
  }) {
    const all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    const start = (page - 1) * limit
    let docs = all.slice(start, start + limit)
    const hasNextPage = start + limit < all.length
    if (depth >= 1 && collection === 'catalog-relations') {
      docs = docs.map((d) => ({ ...d, from: this.populate(d.from), to: this.populate(d.to) }))
    }
    return { docs, hasNextPage }
  }

  private populate(idOrDoc: unknown): unknown {
    if (typeof idOrDoc !== 'string') return idOrDoc
    return this.collections['catalog-entities'].find((e) => e.id === idOrDoc) ?? idOrDoc
  }

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return doc
  }

  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    if (this.throwOnWrite.has(collection)) throw new Error(`create ${collection} blew up`)
    const doc = { id: this.nextId(collection), ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }

  async update({ collection, id, data }: { collection: string; id: string; data: Record<string, unknown> }) {
    if (this.throwOnWrite.has(collection)) throw new Error(`update ${collection} blew up`)
    const list = this.collections[collection] ?? []
    const idx = list.findIndex((d) => d.id === id)
    if (idx === -1) throw new Error(`${collection}/${id} not found`)
    list[idx] = { ...list[idx], ...data }
    return list[idx]
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
    } else if ('exists' in cond) {
      const exists = raw !== undefined && raw !== null
      if (exists !== cond.exists) return false
    }
  }
  return true
}

/** Let all fire-and-forget microtasks/timeouts settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0))
}

// --- syncInitiativeActionItems ----------------------------------------------

describe('syncInitiativeActionItems', () => {
  function seed(): FakePayload {
    const fp = new FakePayload()
    fp.collections['scorecards'] = [
      { id: 'sc1', workspace: 'ws1', levels: [{ name: 'Bronze', rank: 1 }, { name: 'Gold', rank: 3 }] },
    ]
    fp.collections['scorecard-rules'] = [
      { id: 'base', scorecard: 'sc1', workspace: 'ws1', level: null },
      { id: 'bronze', scorecard: 'sc1', workspace: 'ws1', level: 'Bronze' },
      { id: 'gold', scorecard: 'sc1', workspace: 'ws1', level: 'Gold' },
    ]
    fp.collections['initiatives'] = [
      { id: 'ini1', workspace: 'ws1', scorecard: 'sc1', targetLevel: 'Bronze', status: 'active' },
    ]
    return fp
  }

  it('creates open items for failing in-scope pairs, ignoring out-of-scope failures', async () => {
    const fp = seed()
    fp.collections['scorecard-rule-results'] = [
      { id: 'rr1', scorecard: 'sc1', rule: 'base', entity: 'e1', passed: false, evaluatedAt: '2026-07-01T00:00:00.000Z' },
      { id: 'rr2', scorecard: 'sc1', rule: 'bronze', entity: 'e1', passed: false, evaluatedAt: '2026-07-01T00:00:00.000Z' },
      { id: 'rr3', scorecard: 'sc1', rule: 'gold', entity: 'e1', passed: false, evaluatedAt: '2026-07-01T00:00:00.000Z' }, // out of scope for Bronze
    ]

    const result = await syncInitiativeActionItems(fp as unknown as Payload, 'ini1')

    expect(result).toEqual({ created: 2, completed: 0, reopened: 0 })
    const items = fp.collections['initiative-action-items']
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.status === 'open' && i.initiative === 'ini1' && i.workspace === 'ws1')).toBe(true)
    expect(items.map((i) => i.rule).sort()).toEqual(['base', 'bronze'])
  })

  it('auto-completes an open item whose rule now passes, appending a note', async () => {
    const fp = seed()
    fp.collections['scorecard-rule-results'] = [
      { id: 'rr1', scorecard: 'sc1', rule: 'base', entity: 'e1', passed: true, evaluatedAt: '2026-07-02T00:00:00.000Z' },
    ]
    fp.collections['initiative-action-items'] = [
      { id: 'ai1', workspace: 'ws1', initiative: 'ini1', entity: 'e1', rule: 'base', status: 'open', notes: 'looking into it' },
    ]

    const result = await syncInitiativeActionItems(fp as unknown as Payload, 'ini1')

    expect(result).toEqual({ created: 0, completed: 1, reopened: 0 })
    const item = fp.collections['initiative-action-items'][0]
    expect(item.status).toBe('done')
    expect(item.notes).toBe(`looking into it\n${AUTO_COMPLETE_NOTE}`)
  })

  it('reopens a done item whose rule fails again, appending a note', async () => {
    const fp = seed()
    fp.collections['scorecard-rule-results'] = [
      { id: 'rr1', scorecard: 'sc1', rule: 'base', entity: 'e1', passed: false, evaluatedAt: '2026-07-02T00:00:00.000Z' },
    ]
    fp.collections['initiative-action-items'] = [
      { id: 'ai1', workspace: 'ws1', initiative: 'ini1', entity: 'e1', rule: 'base', status: 'done', notes: null },
    ]

    const result = await syncInitiativeActionItems(fp as unknown as Payload, 'ini1')

    expect(result).toEqual({ created: 0, completed: 0, reopened: 1 })
    const item = fp.collections['initiative-action-items'][0]
    expect(item.status).toBe('open')
    expect(item.notes).toBe(REOPEN_NOTE)
  })

  it('never touches a waived item and returns zeros for a settled initiative', async () => {
    const fp = seed()
    fp.collections['scorecard-rule-results'] = [
      { id: 'rr1', scorecard: 'sc1', rule: 'base', entity: 'e1', passed: false, evaluatedAt: '2026-07-02T00:00:00.000Z' },
    ]
    fp.collections['initiative-action-items'] = [
      { id: 'ai1', workspace: 'ws1', initiative: 'ini1', entity: 'e1', rule: 'base', status: 'waived', notes: 'accepted' },
    ]

    const result = await syncInitiativeActionItems(fp as unknown as Payload, 'ini1')

    expect(result).toEqual({ created: 0, completed: 0, reopened: 0 })
    expect(fp.collections['initiative-action-items'][0]).toMatchObject({ status: 'waived', notes: 'accepted' })
  })

  it('is a no-op returning zeros for a non-active initiative', async () => {
    const fp = seed()
    fp.collections['initiatives'][0].status = 'completed'
    fp.collections['scorecard-rule-results'] = [
      { id: 'rr1', scorecard: 'sc1', rule: 'base', entity: 'e1', passed: false, evaluatedAt: '2026-07-02T00:00:00.000Z' },
    ]

    const result = await syncInitiativeActionItems(fp as unknown as Payload, 'ini1')

    expect(result).toEqual({ created: 0, completed: 0, reopened: 0 })
    expect(fp.collections['initiative-action-items']).toHaveLength(0)
  })

  it('returns zeros when the initiative does not exist', async () => {
    const fp = seed()
    const result = await syncInitiativeActionItems(fp as unknown as Payload, 'missing')
    expect(result).toEqual({ created: 0, completed: 0, reopened: 0 })
  })
})

// --- runScorecardEvaluation hook-in -----------------------------------------

describe('runScorecardEvaluation → initiative sync hook', () => {
  function seedEval(): FakePayload {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]
    fp.collections['scorecards'] = [{ id: 'sc1', workspace: 'ws1', levels: [{ name: 'Bronze', rank: 1 }] }]
    // A rule that fails for e1 (owner is not set) so the initiative has work to do.
    fp.collections['scorecard-rules'] = [
      { id: 'base', scorecard: 'sc1', workspace: 'ws1', level: null, type: 'field-presence', weight: 1, expression: { path: 'owner', op: 'exists' } },
    ]
    fp.collections['initiatives'] = [
      { id: 'ini1', workspace: 'ws1', scorecard: 'sc1', targetLevel: 'Bronze', status: 'active' },
    ]
    return fp
  }

  it('resolves with the evaluation summary and syncs active initiatives (fire-and-forget)', async () => {
    const fp = seedEval()

    const summary = await runScorecardEvaluation(fp as unknown as Payload, 'sc1')
    expect(summary.entitiesEvaluated).toBe(1)
    expect(summary.rulesEvaluated).toBe(1)

    await flush()

    const items = fp.collections['initiative-action-items']
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ initiative: 'ini1', entity: 'e1', rule: 'base', status: 'open' })
  })

  it('does not sync completed/cancelled initiatives', async () => {
    const fp = seedEval()
    fp.collections['initiatives'][0].status = 'completed'

    await runScorecardEvaluation(fp as unknown as Payload, 'sc1')
    await flush()

    expect(fp.collections['initiative-action-items']).toHaveLength(0)
  })

  it('a sync failure never fails the evaluation', async () => {
    const fp = seedEval()
    fp.throwOnWrite.add('initiative-action-items') // any sync write throws

    // Must resolve (not reject) despite the sync error swallowed by the hook.
    const summary = await runScorecardEvaluation(fp as unknown as Payload, 'sc1')
    expect(summary.entitiesEvaluated).toBe(1)

    await flush()
    // The throwing write left no items behind, but evaluation still succeeded.
    expect(fp.collections['initiative-action-items']).toHaveLength(0)
  })
})

// --- assignee workspace validation ------------------------------------------

describe('isActiveWorkspaceMember / assertAssigneeInWorkspace', () => {
  function seed(): FakePayload {
    const fp = new FakePayload()
    fp.collections['workspace-members'] = [
      { id: 'm1', user: 'u-member', workspace: 'ws1', status: 'active' },
      { id: 'm2', user: 'u-inactive', workspace: 'ws1', status: 'invited' },
      { id: 'm3', user: 'u-other-ws', workspace: 'ws2', status: 'active' },
    ]
    return fp
  }

  it('isActiveWorkspaceMember is true only for an active member of the workspace', async () => {
    const fp = seed()
    expect(await isActiveWorkspaceMember(fp as unknown as Payload, 'u-member', 'ws1')).toBe(true)
    expect(await isActiveWorkspaceMember(fp as unknown as Payload, 'u-inactive', 'ws1')).toBe(false)
    expect(await isActiveWorkspaceMember(fp as unknown as Payload, 'u-other-ws', 'ws1')).toBe(false)
    expect(await isActiveWorkspaceMember(fp as unknown as Payload, 'u-nobody', 'ws1')).toBe(false)
  })

  it('assertAssigneeInWorkspace accepts an active member of the workspace', async () => {
    const fp = seed()
    await expect(assertAssigneeInWorkspace(fp as unknown as Payload, 'u-member', 'ws1')).resolves.toBeUndefined()
  })

  it('assertAssigneeInWorkspace rejects a foreign/non-member user', async () => {
    const fp = seed()
    await expect(assertAssigneeInWorkspace(fp as unknown as Payload, 'u-other-ws', 'ws1')).rejects.toThrow(
      /active member/i,
    )
    await expect(assertAssigneeInWorkspace(fp as unknown as Payload, 'u-nobody', 'ws1')).rejects.toThrow()
  })

  it('assertAssigneeInWorkspace passes through when clearing the assignee (null/undefined/empty), issuing no query', async () => {
    const fp = seed()
    // No workspace-members rows at all → would reject any concrete id, but
    // clearing must still pass without touching the collection.
    fp.collections['workspace-members'] = []
    await expect(assertAssigneeInWorkspace(fp as unknown as Payload, null, 'ws1')).resolves.toBeUndefined()
    await expect(assertAssigneeInWorkspace(fp as unknown as Payload, undefined, 'ws1')).resolves.toBeUndefined()
    await expect(assertAssigneeInWorkspace(fp as unknown as Payload, '', 'ws1')).resolves.toBeUndefined()
  })
})
