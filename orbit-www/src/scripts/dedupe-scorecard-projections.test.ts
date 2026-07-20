import { describe, expect, it, vi } from 'vitest'
import { dedupeCollection, selectDuplicateSurvivor, type DuplicateCandidate } from './dedupe-scorecard-projections'

function candidate(
  id: string,
  evaluatedAt?: string,
  updatedAt?: string,
): DuplicateCandidate {
  return { id, evaluatedAt, updatedAt }
}

describe('selectDuplicateSurvivor', () => {
  it('prefers newest evaluatedAt, then updatedAt, then the stable greatest id', () => {
    expect(
      selectDuplicateSurvivor([
        candidate('a', '2026-01-01T00:00:00.000Z'),
        candidate('b', '2026-01-02T00:00:00.000Z'),
      ]).id,
    ).toBe('b')

    expect(
      selectDuplicateSurvivor([
        candidate('a', undefined, '2026-01-02T00:00:00.000Z'),
        candidate('b', undefined, '2026-01-02T00:00:00.000Z'),
      ]).id,
    ).toBe('b')
  })
})

describe('dedupeCollection', () => {
  it('reports deterministic losers without deleting in dry-run mode', async () => {
    const deleteMany = vi.fn()
    const collection = {
      aggregate: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([
          {
            candidates: [
              candidate('old', '2026-01-01T00:00:00.000Z'),
              candidate('new', '2026-01-02T00:00:00.000Z'),
            ],
            count: 2,
          },
        ]),
      })),
      deleteMany,
    }

    const result = await dedupeCollection(collection, ['scorecard', 'rule', 'entity'], false)

    expect(result).toEqual({ duplicateGroups: 1, duplicatesRemoved: 1 })
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('deletes losers and is idempotent when rerun', async () => {
    let groups = [
      {
        candidates: [
          candidate('old', '2026-01-01T00:00:00.000Z'),
          candidate('new', '2026-01-02T00:00:00.000Z'),
        ],
        count: 2,
      },
    ]
    const collection = {
      aggregate: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(groups) })),
      deleteMany: vi.fn(async () => {
        groups = []
        return { deletedCount: 1 }
      }),
    }

    await expect(
      dedupeCollection(collection, ['scorecard', 'rule', 'entity'], true),
    ).resolves.toEqual({ duplicateGroups: 1, duplicatesRemoved: 1 })
    await expect(
      dedupeCollection(collection, ['scorecard', 'rule', 'entity'], true),
    ).resolves.toEqual({ duplicateGroups: 0, duplicatesRemoved: 0 })

    expect(collection.deleteMany).toHaveBeenCalledTimes(1)
    expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['old'] } })
  })
})
