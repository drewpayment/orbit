import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/authz', () => ({ memberWorkspaceIds: vi.fn() }))

import { memberWorkspaceIds } from '@/lib/authz'
import { actorMayUseSource } from './workspace-access'

const actor = (over: Record<string, unknown> = {}) =>
  ({ payloadId: 'pl-1', betterAuthId: 'ba-1', isPlatformAdmin: false, ...over }) as any

describe('actorMayUseSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(memberWorkspaceIds as any).mockResolvedValue(['ws-1', 'ws-2'])
  })

  it('allows a member of one of the allowed workspaces (ids or populated docs)', async () => {
    await expect(actorMayUseSource(actor(), ['ws-9', 'ws-2'])).resolves.toBe(true)
    await expect(actorMayUseSource(actor(), [{ id: 'ws-1' }])).resolves.toBe(true)
  })

  it('denies a user with no membership in any allowed workspace', async () => {
    await expect(actorMayUseSource(actor(), ['ws-9'])).resolves.toBe(false)
  })

  it('denies when allowedWorkspaces is empty or missing (nobody has been granted it)', async () => {
    await expect(actorMayUseSource(actor(), [])).resolves.toBe(false)
    await expect(actorMayUseSource(actor(), undefined)).resolves.toBe(false)
    await expect(actorMayUseSource(actor(), null)).resolves.toBe(false)
  })

  it('lets a platform admin through without a membership lookup', async () => {
    await expect(actorMayUseSource(actor({ isPlatformAdmin: true }), [])).resolves.toBe(true)
    expect(memberWorkspaceIds).not.toHaveBeenCalled()
  })
})

import { installationAllowedForWorkspace } from './workspace-access'

describe('installationAllowedForWorkspace', () => {
  const find = vi.fn()
  const payload = { find } as any

  beforeEach(() => {
    find.mockReset()
    find.mockResolvedValue({ docs: [{ id: 'i-1' }] })
  })

  it('allows an installation granted to the workspace (payload id)', async () => {
    await expect(installationAllowedForWorkspace(payload, 'a'.repeat(24), 'ws-1')).resolves.toBe(true)
    const q = JSON.stringify(find.mock.calls[0][0].where)
    expect(q).toContain('"allowedWorkspaces":{"contains":"ws-1"}')
    expect(q).toContain('"id":{"equals"')
  })

  it('also resolves the numeric GitHub installation id', async () => {
    await installationAllowedForWorkspace(payload, '12345', 'ws-1')
    expect(JSON.stringify(find.mock.calls[0][0].where)).toContain('"installationId":{"equals":12345}')
  })

  it('denies when no doc matches both the ref and the workspace', async () => {
    find.mockResolvedValue({ docs: [] })
    await expect(installationAllowedForWorkspace(payload, '12345', 'ws-2')).resolves.toBe(false)
  })

  it('denies malformed/empty refs and missing workspace without querying', async () => {
    await expect(installationAllowedForWorkspace(payload, 'not-an-id', 'ws-1')).resolves.toBe(false)
    await expect(installationAllowedForWorkspace(payload, '', 'ws-1')).resolves.toBe(false)
    await expect(installationAllowedForWorkspace(payload, undefined, 'ws-1')).resolves.toBe(false)
    await expect(installationAllowedForWorkspace(payload, '12345', null)).resolves.toBe(false)
    expect(find).not.toHaveBeenCalled()
  })

  it('denies when the lookup throws', async () => {
    find.mockRejectedValue(new Error('boom'))
    await expect(installationAllowedForWorkspace(payload, '12345', 'ws-1')).resolves.toBe(false)
  })
})

import { resolveInstallationForWorkspace, findInstallationByRef } from './workspace-access'

describe('resolveInstallationForWorkspace / findInstallationByRef', () => {
  const find = vi.fn()
  const findByID = vi.fn()
  const payload = { find, findByID } as any
  const doc = { id: 'a'.repeat(24), installationId: 987654, allowedWorkspaces: ['ws-1'] }

  beforeEach(() => {
    find.mockReset()
    findByID.mockReset()
  })

  it('maps a Payload-id ref to the numeric GitHub installation id (not NaN)', async () => {
    find.mockResolvedValue({ docs: [doc] })
    const r = await resolveInstallationForWorkspace(payload, 'a'.repeat(24), 'ws-1')
    expect(r).toEqual({ id: 'a'.repeat(24), githubInstallationId: 987654, allowedWorkspaces: ['ws-1'] })
  })

  it('tolerates a legacy numeric ref', async () => {
    find.mockResolvedValue({ docs: [doc] })
    const r = await resolveInstallationForWorkspace(payload, '987654', 'ws-1')
    expect(r?.githubInstallationId).toBe(987654)
    expect(JSON.stringify(find.mock.calls[0][0].where)).toContain('"installationId":{"equals":987654}')
  })

  it('returns null when not granted, or the doc has no numeric installation id', async () => {
    find.mockResolvedValue({ docs: [] })
    await expect(resolveInstallationForWorkspace(payload, 'a'.repeat(24), 'ws-2')).resolves.toBeNull()
    find.mockResolvedValue({ docs: [{ id: 'a'.repeat(24) }] })
    await expect(resolveInstallationForWorkspace(payload, 'a'.repeat(24), 'ws-1')).resolves.toBeNull()
  })

  it('findInstallationByRef resolves a doc id via findByID and a numeric ref via find', async () => {
    findByID.mockResolvedValue(doc)
    await expect(findInstallationByRef(payload, 'a'.repeat(24))).resolves.toMatchObject({ githubInstallationId: 987654 })
    find.mockResolvedValue({ docs: [doc] })
    await expect(findInstallationByRef(payload, '987654')).resolves.toMatchObject({ id: 'a'.repeat(24) })
    findByID.mockRejectedValue(new Error('Not Found'))
    await expect(findInstallationByRef(payload, 'b'.repeat(24))).resolves.toBeNull()
  })
})
