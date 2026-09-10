import { describe, expect, it, vi } from 'vitest'
import {
  getEntitiesForWorkspace,
  getReposForConnection,
  getTeamsForWorkspace,
} from './picker-data'

/** Minimal fake Payload client — only the methods these functions call. */
function fakePayload(overrides: {
  workspaceMembers?: Array<Record<string, unknown>>
  entities?: Array<Record<string, unknown>>
  gitConnections?: Record<string, Record<string, unknown>>
}) {
  const { workspaceMembers = [], entities = [], gitConnections = {} } = overrides

  return {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: Record<string, unknown> }) => {
      if (collection === 'workspace-members') {
        const and = (where?.and as Array<Record<string, { equals?: unknown }>>) ?? []
        const workspaceClause = and.find((c) => c.workspace)?.workspace?.equals
        const userClause = and.find((c) => c.user)?.user?.equals
        const statusClause = and.find((c) => c.status)?.status?.equals
        const docs = workspaceMembers.filter((m) => {
          if (workspaceClause !== undefined && m.workspace !== workspaceClause) return false
          if (userClause !== undefined && m.user !== userClause) return false
          if (statusClause !== undefined && m.status !== statusClause) return false
          return true
        })
        return { docs }
      }
      if (collection === 'catalog-entities') {
        const and = (where?.and as Array<Record<string, { equals?: unknown; in?: unknown[] }>>) ?? []
        const workspaceClause = and.find((c) => c.workspace)?.workspace?.equals
        const kindClause = and.find((c) => c.kind)?.kind?.equals
        const sourceTypeClause = and.find((c) => c['source.type'])?.['source.type']?.in
        const docs = entities.filter((e) => {
          if (workspaceClause !== undefined && e.workspace !== workspaceClause) return false
          if (kindClause !== undefined && e.kind !== kindClause) return false
          if (sourceTypeClause && !sourceTypeClause.includes(e.sourceType)) return false
          return true
        })
        return { docs }
      }
      return { docs: [] }
    }),
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: string }) => {
      if (collection === 'git-connections') return gitConnections[id]
      return undefined
    }),
  }
}

describe('getTeamsForWorkspace (workspace members proxy — no teams collection yet)', () => {
  it('returns active members of the workspace when the caller is a member', async () => {
    const payload = fakePayload({
      workspaceMembers: [
        { id: 'm1', workspace: 'ws-1', user: 'caller', role: 'owner', status: 'active' },
        { id: 'm2', workspace: 'ws-1', user: 'other', role: 'member', status: 'active' },
      ],
    })

    const result = await getTeamsForWorkspace(payload as never, 'caller', 'ws-1')
    expect(result.map((r) => r.id)).toEqual(['caller', 'other'])
  })

  it('returns empty when the caller is not an active member of the requested workspace (RBAC scoping)', async () => {
    const payload = fakePayload({
      workspaceMembers: [{ id: 'm1', workspace: 'ws-1', user: 'caller', role: 'owner', status: 'active' }],
    })

    // Caller asks for a DIFFERENT workspace they don't belong to.
    const result = await getTeamsForWorkspace(payload as never, 'caller', 'ws-2')
    expect(result).toEqual([])
  })
})

describe('getEntitiesForWorkspace', () => {
  it('scopes entities to the requested workspace and kind, only for a member caller', async () => {
    const payload = fakePayload({
      workspaceMembers: [{ id: 'm1', workspace: 'ws-1', user: 'caller', role: 'member', status: 'active' }],
      entities: [
        { id: 'e1', workspace: 'ws-1', kind: 'service', name: 'svc-a' },
        { id: 'e2', workspace: 'ws-2', kind: 'service', name: 'svc-b' },
      ],
    })

    const result = await getEntitiesForWorkspace(payload as never, 'caller', 'ws-1', 'service')
    expect(result.map((r) => r.id)).toEqual(['e1'])
  })

  it('never leaks another workspace’s entities to a non-member caller', async () => {
    const payload = fakePayload({
      workspaceMembers: [{ id: 'm1', workspace: 'ws-1', user: 'caller', role: 'member', status: 'active' }],
      entities: [{ id: 'e2', workspace: 'ws-2', kind: 'service', name: 'svc-b' }],
    })

    const result = await getEntitiesForWorkspace(payload as never, 'caller', 'ws-2', 'service')
    expect(result).toEqual([])
  })
})

describe('getReposForConnection', () => {
  it('returns proxy "repo" entities only when the connection allows the caller’s workspace', async () => {
    const payload = fakePayload({
      workspaceMembers: [{ id: 'm1', workspace: 'ws-1', user: 'caller', role: 'member', status: 'active' }],
      gitConnections: { 'conn-1': { id: 'conn-1', allowedWorkspaces: ['ws-1'] } },
      entities: [{ id: 'e1', workspace: 'ws-1', kind: 'service', sourceType: 'scan', name: 'repo-a' }],
    })

    const result = await getReposForConnection(payload as never, 'caller', 'ws-1', 'conn-1')
    expect(result.map((r) => r.id)).toEqual(['e1'])
  })

  it('returns empty when the connection does not allow the caller’s workspace', async () => {
    const payload = fakePayload({
      workspaceMembers: [{ id: 'm1', workspace: 'ws-1', user: 'caller', role: 'member', status: 'active' }],
      gitConnections: { 'conn-1': { id: 'conn-1', allowedWorkspaces: ['ws-99'] } },
      entities: [{ id: 'e1', workspace: 'ws-1', kind: 'service', sourceType: 'scan', name: 'repo-a' }],
    })

    const result = await getReposForConnection(payload as never, 'caller', 'ws-1', 'conn-1')
    expect(result).toEqual([])
  })

  it('returns empty when the caller is not a member of the requested workspace', async () => {
    const payload = fakePayload({
      workspaceMembers: [],
      gitConnections: { 'conn-1': { id: 'conn-1', allowedWorkspaces: ['ws-1'] } },
      entities: [{ id: 'e1', workspace: 'ws-1', kind: 'service', sourceType: 'scan', name: 'repo-a' }],
    })

    const result = await getReposForConnection(payload as never, 'caller', 'ws-1', 'conn-1')
    expect(result).toEqual([])
  })
})
