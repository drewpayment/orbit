/**
 * @vitest-environment node
 *
 * `validateActionItemRelationships`'s assignee check (Phase C, #135) delegates
 * to `@/lib/authz/membership`'s `membershipRole`, which is wrapped in React
 * `cache()` — under the suite's default `jsdom` environment that resolves to
 * React's client build, where `cache()` silently no-ops instead of invoking
 * the wrapped function (matches the pattern in
 * `lib/authz/__tests__/policy.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  validateActionItemRelationships,
  validateInitiativeRelationships,
  validateRuleRelationships,
} from './invariants'
import { EntityScores } from './EntityScores'
import { InitiativeActionItems } from './InitiativeActionItems'
import { ScorecardRuleResults } from './ScorecardRuleResults'

function requestWith(
  docs: Record<string, Record<string, unknown>>,
  members: Array<{ workspace: string; user: string; role: string; status: string }> = [],
) {
  return {
    payload: {
      findByID: vi.fn(async ({ collection, id }: { collection: string; id: string }) => {
        const doc = docs[`${collection}:${id}`]
        if (!doc) throw new Error(`${collection}/${id} not found`)
        return doc
      }),
      find: vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
        if (collection !== 'workspace-members') return { docs: [], totalDocs: 0 }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const and: any[] = (where as any)?.and ?? []
        const filtered = members.filter((m) =>
          and.every((c) => {
            if (c.workspace) return m.workspace === c.workspace.equals
            if (c.user) return m.user === c.user.equals
            if (c.status) return m.status === c.status.equals
            return true
          }),
        )
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return { docs: filtered, totalDocs: filtered.length }
      }),
    },
  }
}

describe('scorecard relationship invariants', () => {
  it('rejects a rule whose denormalised workspace differs from its scorecard', async () => {
    const req = requestWith({
      'scorecards:sc1': { id: 'sc1', workspace: 'ws1', levels: [] },
    })

    await expect(
      validateRuleRelationships({
        data: { scorecard: 'sc1', workspace: 'ws2', weight: 1 },
        req,
      } as never),
    ).rejects.toThrow('same workspace')
  })

  it('rejects an initiative target level absent from the parent scorecard', async () => {
    const req = requestWith({
      'scorecards:sc1': { id: 'sc1', workspace: 'ws1', levels: [{ name: 'Bronze', rank: 1 }] },
    })

    await expect(
      validateInitiativeRelationships({
        data: { scorecard: 'sc1', workspace: 'ws1', targetLevel: 'Gold' },
        req,
      } as never),
    ).rejects.toThrow('target level')
  })

  it('rejects an action item whose rule belongs to another scorecard', async () => {
    const req = requestWith({
      'initiatives:i1': { id: 'i1', workspace: 'ws1', scorecard: 'sc1' },
      'catalog-entities:e1': { id: 'e1', workspace: 'ws1' },
      'scorecard-rules:r1': { id: 'r1', workspace: 'ws1', scorecard: 'sc2' },
    })

    await expect(
      validateActionItemRelationships({
        data: { initiative: 'i1', entity: 'e1', rule: 'r1', workspace: 'ws1' },
        req,
      } as never),
    ).rejects.toThrow('initiative scorecard')
  })

  it('rejects an assignee without an active membership in the action-item workspace', async () => {
    const req = requestWith(
      {
        'initiatives:i1': { id: 'i1', workspace: 'ws1', scorecard: 'sc1' },
        'catalog-entities:e1': { id: 'e1', workspace: 'ws1' },
        'users:u1': { id: 'u1', betterAuthId: 'ba1' },
      },
      [],
    )

    await expect(
      validateActionItemRelationships({
        data: { initiative: 'i1', entity: 'e1', assignee: 'u1', workspace: 'ws1' },
        req,
      } as never),
    ).rejects.toThrow('active workspace member')
  })

  it('accepts an assignee who is an active member of the action-item workspace', async () => {
    const req = requestWith(
      {
        'initiatives:i1': { id: 'i1', workspace: 'ws1', scorecard: 'sc1' },
        'catalog-entities:e1': { id: 'e1', workspace: 'ws1' },
        'users:u1': { id: 'u1', betterAuthId: 'ba1' },
      },
      [{ workspace: 'ws1', user: 'ba1', role: 'member', status: 'active' }],
    )

    await expect(
      validateActionItemRelationships({
        data: { initiative: 'i1', entity: 'e1', assignee: 'u1', workspace: 'ws1' },
        req,
      } as never),
    ).resolves.toBeDefined()
  })
})

describe('scorecard projection idempotency indexes', () => {
  it('enforces one rule result, entity score, and initiative item per logical key', () => {
    expect(ScorecardRuleResults.indexes).toContainEqual({
      fields: ['scorecard', 'rule', 'entity'],
      unique: true,
    })
    expect(EntityScores.indexes).toContainEqual({
      fields: ['entity', 'scope', 'scorecard'],
      unique: true,
    })
    expect(InitiativeActionItems.indexes).toContainEqual({
      fields: ['initiative', 'entity', 'rule'],
      unique: true,
    })
  })
})
