import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import { isTeamEntity } from './entities'

describe('isTeamEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is true for an existing entity of kind team', async () => {
    const payload = {
      findByID: vi.fn(async () => ({ id: 'e1', kind: 'team' })),
    } as unknown as Payload
    expect(await isTeamEntity(payload, 'e1')).toBe(true)
  })

  it('is false for an existing non-team entity', async () => {
    const payload = {
      findByID: vi.fn(async () => ({ id: 'e1', kind: 'service' })),
    } as unknown as Payload
    expect(await isTeamEntity(payload, 'e1')).toBe(false)
  })

  it('is false when the entity does not exist (findByID throws)', async () => {
    const payload = {
      findByID: vi.fn(async () => {
        throw new Error('not found')
      }),
    } as unknown as Payload
    expect(await isTeamEntity(payload, 'missing')).toBe(false)
  })
})
