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
