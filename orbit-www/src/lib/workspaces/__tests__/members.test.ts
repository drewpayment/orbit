/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import {
  listWorkspaceMembers,
  countWorkspaceMembers,
  listMembershipsFor,
  addWorkspaceMember,
  deleteWorkspaceMembers,
} from '../members'

const find = vi.fn()
const create = vi.fn()
const update = vi.fn()
const del = vi.fn()
const payload = { find, create, update, delete: del } as unknown as Payload

beforeEach(() => {
  find.mockReset()
  create.mockReset()
  update.mockReset()
  del.mockReset()
})

describe('roster reads', () => {
  it('listWorkspaceMembers filters active rows of the workspace, optionally by role, with overrideAccess', async () => {
    find.mockResolvedValue({ docs: [{ id: 'm1' }] })
    await listWorkspaceMembers(payload, 'ws-1', { roles: ['owner', 'admin'] })
    const args = find.mock.calls[0][0]
    expect(args.collection).toBe('workspace-members')
    expect(args.where.and).toEqual([
      { workspace: { equals: 'ws-1' } },
      { status: { equals: 'active' } },
      { role: { in: ['owner', 'admin'] } },
    ])
    expect(args.overrideAccess).toBe(true)
  })

  it('countWorkspaceMembers returns totalDocs with limit 0', async () => {
    find.mockResolvedValue({ docs: [], totalDocs: 7 })
    expect(await countWorkspaceMembers(payload, 'ws-1')).toBe(7)
    expect(find.mock.calls[0][0].limit).toBe(0)
  })

  it('listMembershipsFor keys on the Better-Auth id and returns workspaceId/role pairs', async () => {
    find.mockResolvedValue({
      docs: [
        { id: 'm1', workspace: 'ws-1', role: 'owner', status: 'active' },
        { id: 'm2', workspace: { id: 'ws-2' }, role: 'member', status: 'active' },
      ],
    })
    const rows = await listMembershipsFor(payload, 'ba-1')
    expect(find.mock.calls[0][0].where.and).toContainEqual({ user: { equals: 'ba-1' } })
    expect(rows).toEqual([
      { workspaceId: 'ws-1', role: 'owner', memberId: 'm1' },
      { workspaceId: 'ws-2', role: 'member', memberId: 'm2' },
    ])
  })
})

describe('addWorkspaceMember', () => {
  it('creates an active row when none exists', async () => {
    find.mockResolvedValue({ docs: [] })
    create.mockResolvedValue({ id: 'm-new' })
    const r = await addWorkspaceMember(payload, { workspaceId: 'ws-1', betterAuthId: 'ba-1', role: 'member' })
    expect(r.created).toBe(true)
    expect(create.mock.calls[0][0].data).toMatchObject({ workspace: 'ws-1', user: 'ba-1', role: 'member', status: 'active' })
  })

  it('is idempotent on an existing row and only upgrades when asked', async () => {
    find.mockResolvedValue({ docs: [{ id: 'm1', role: 'member' }] })
    const same = await addWorkspaceMember(payload, { workspaceId: 'ws-1', betterAuthId: 'ba-1', role: 'admin' })
    expect(same.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    update.mockResolvedValue({ id: 'm1', role: 'admin' })
    const up = await addWorkspaceMember(payload, { workspaceId: 'ws-1', betterAuthId: 'ba-1', role: 'admin', upgradeRole: true })
    expect(up.created).toBe(false)
    expect(update.mock.calls[0][0]).toMatchObject({ id: 'm1', data: { role: 'admin', status: 'active' } })
  })
})

describe('deleteWorkspaceMembers', () => {
  it('bulk-deletes by workspace and returns the count', async () => {
    del.mockResolvedValue({ docs: [{ id: 'a' }, { id: 'b' }] })
    expect(await deleteWorkspaceMembers(payload, 'ws-1')).toBe(2)
    expect(del.mock.calls[0][0]).toMatchObject({ where: { workspace: { equals: 'ws-1' } }, overrideAccess: true })
  })
})
