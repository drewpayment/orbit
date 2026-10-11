import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Mock @/lib/authz at the module boundary (the real actor.ts opens a Mongo client).
vi.mock('@/lib/authz', () => ({
  requireActor: vi.fn(),
  authorize: vi.fn(),
  ALL_ROLES: ['owner', 'admin', 'member'],
  MANAGE_ROLES: ['owner', 'admin'],
}))

import { getPayload } from 'payload'
import { requireActor, authorize } from '@/lib/authz'
import {
  createAPISchema,
  updateAPISchema,
  deleteAPISchema,
  restoreVersion,
  getWorkspaceAPIs,
  getAPISchema,
  deprecateAPISchema,
  getAPISchemaVersions,
} from '../actions'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

class Unauthenticated extends Error {}
class Forbidden extends Error {}

const schemaDoc = {
  id: 'schema-1',
  workspace: 'ws-1',
  createdBy: 'pl-other',
  rawContent: 'old',
  latestVersionNumber: 1,
}

function makePayload() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'new-1', currentVersion: 'v1' }),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    find: vi.fn().mockResolvedValue({ docs: [] }),
    findByID: vi.fn().mockResolvedValue(schemaDoc),
  }
}

const createInput = {
  name: 'API',
  slug: 'api',
  workspaceId: 'ws-1',
  visibility: 'workspace' as const,
  rawContent: 'openapi: 3.0.0',
}

describe('workspace API schema actions: authentication and authorization', () => {
  let payload: ReturnType<typeof makePayload>

  beforeEach(() => {
    vi.clearAllMocks()
    payload = makePayload()
    ;(getPayload as any).mockResolvedValue(payload)
    ;(requireActor as any).mockResolvedValue(actor)
    ;(authorize as any).mockResolvedValue(actor)
  })

  const denyUnauthenticated = () => (requireActor as any).mockRejectedValue(new Unauthenticated('Unauthenticated'))
  const denyForbidden = () => (authorize as any).mockRejectedValue(new Forbidden('Forbidden'))

  describe('createAPISchema', () => {
    it('rejects unauthenticated callers without touching payload', async () => {
      denyUnauthenticated()
      ;(authorize as any).mockRejectedValue(new Unauthenticated('Unauthenticated'))
      await expect(createAPISchema(createInput)).rejects.toThrow()
      expect(payload.create).not.toHaveBeenCalled()
    })

    it('rejects non-members of the target workspace', async () => {
      denyForbidden()
      await expect(createAPISchema(createInput)).rejects.toThrow('Forbidden')
      expect(authorize).toHaveBeenCalledWith('create', { kind: 'workspace', id: 'ws-1' })
      expect(payload.create).not.toHaveBeenCalled()
    })

    it('attributes the schema and version to the session actor, ignoring a client userId', async () => {
      await createAPISchema({ ...createInput, userId: 'attacker-chosen' } as any)
      const calls = payload.create.mock.calls.map((c: any[]) => c[0])
      expect(calls).toHaveLength(2)
      for (const c of calls) {
        expect(c.data.createdBy).toBe('pl-1')
      }
    })
  })

  describe('updateAPISchema', () => {
    it('rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      await expect(updateAPISchema({ id: 'schema-1', name: 'x' })).rejects.toThrow()
      expect(payload.update).not.toHaveBeenCalled()
    })

    it('rejects callers who cannot update the schema workspace doc', async () => {
      denyForbidden()
      await expect(updateAPISchema({ id: 'schema-1', name: 'x' })).rejects.toThrow('Forbidden')
      expect(authorize).toHaveBeenCalledWith(
        'update',
        expect.objectContaining({ kind: 'doc', workspaceId: 'ws-1', ownerPayloadId: 'pl-other' }),
        actor,
      )
      expect(payload.update).not.toHaveBeenCalled()
    })

    it('records lastEditedBy as the session actor, ignoring a client userId', async () => {
      await updateAPISchema({ id: 'schema-1', name: 'x', userId: 'attacker-chosen' } as any)
      expect(payload.update.mock.calls[0][0].data.lastEditedBy).toBe('pl-1')
    })
  })

  describe('deleteAPISchema', () => {
    it('rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      await expect(deleteAPISchema('schema-1')).rejects.toThrow()
      expect(payload.delete).not.toHaveBeenCalled()
    })

    it('rejects callers without delete rights', async () => {
      denyForbidden()
      await expect(deleteAPISchema('schema-1')).rejects.toThrow('Forbidden')
      expect(payload.delete).not.toHaveBeenCalled()
      expect(payload.find).not.toHaveBeenCalled()
    })

    it('deletes versions then the schema for an authorized caller', async () => {
      payload.find.mockResolvedValue({ docs: [{ id: 'v1' }] })
      await deleteAPISchema('schema-1')
      expect(authorize).toHaveBeenCalledWith(
        'delete',
        expect.objectContaining({ kind: 'doc', workspaceId: 'ws-1' }),
        actor,
      )
      expect(payload.delete).toHaveBeenCalledTimes(2)
    })
  })

  describe('restoreVersion', () => {
    it('rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      await expect(restoreVersion('schema-1', 'ver-1')).rejects.toThrow()
      expect(payload.update).not.toHaveBeenCalled()
    })

    it('refuses a version that belongs to a different schema', async () => {
      payload.findByID.mockImplementation(async ({ collection }: any) =>
        collection === 'api-schema-versions'
          ? { id: 'ver-1', schema: 'other-schema', rawContent: 'x', version: 'v1' }
          : schemaDoc,
      )
      await expect(restoreVersion('schema-1', 'ver-1')).rejects.toThrow()
      expect(payload.update).not.toHaveBeenCalled()
    })
  })

  describe('getWorkspaceAPIs', () => {
    it('rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      ;(authorize as any).mockRejectedValue(new Unauthenticated('Unauthenticated'))
      await expect(getWorkspaceAPIs('ws-1')).rejects.toThrow()
      expect(payload.find).not.toHaveBeenCalled()
    })

    it('rejects non-members', async () => {
      denyForbidden()
      await expect(getWorkspaceAPIs('ws-1')).rejects.toThrow('Forbidden')
      expect(payload.find).not.toHaveBeenCalled()
    })

    it('reads through collection access as the actor for a member', async () => {
      payload.find.mockResolvedValue({ docs: [{ id: 'a' }] })
      const docs = await getWorkspaceAPIs('ws-1')
      expect(docs).toEqual([{ id: 'a' }])
      expect(payload.find.mock.calls[0][0]).toMatchObject({
        user: actor.user,
        overrideAccess: false,
      })
    })
  })

  describe('getAPISchema / getAPISchemaVersions / deprecateAPISchema', () => {
    it('getAPISchema rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      await expect(getAPISchema('schema-1')).rejects.toThrow()
      expect(payload.findByID).not.toHaveBeenCalled()
    })

    it('getAPISchema reads under the actor access rules', async () => {
      await getAPISchema('schema-1')
      expect(payload.findByID.mock.calls[0][0]).toMatchObject({ user: actor.user, overrideAccess: false })
    })

    it('getAPISchemaVersions rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      await expect(getAPISchemaVersions('schema-1')).rejects.toThrow()
      expect(payload.find).not.toHaveBeenCalled()
    })

    it('getAPISchemaVersions reads under the actor access rules', async () => {
      await getAPISchemaVersions('schema-1')
      expect(payload.find.mock.calls[0][0]).toMatchObject({ user: actor.user, overrideAccess: false })
    })

    it('deprecateAPISchema rejects unauthenticated callers', async () => {
      denyUnauthenticated()
      await expect(deprecateAPISchema('schema-1')).rejects.toThrow()
      expect(payload.update).not.toHaveBeenCalled()
    })

    it('deprecateAPISchema rejects non-members', async () => {
      denyForbidden()
      await expect(deprecateAPISchema('schema-1')).rejects.toThrow('Forbidden')
      expect(payload.update).not.toHaveBeenCalled()
    })
  })
})
