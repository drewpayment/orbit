import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const startWorkflow = vi.fn().mockResolvedValue({})
vi.mock('@/lib/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: { start: startWorkflow } })),
}))

vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
}))

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import { registerSchema, registerCluster, validateCluster, deleteCluster, listClusters } from '../actions'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

const input = {
  topicId: 'topic-1',
  type: 'value' as const,
  format: 'avro' as const,
  content: '{}',
}

describe('registerSchema authorization', () => {
  let payload: { findByID: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    // Schema registration is a hidden preview feature (lib/features.ts); enable it
    // so these tests exercise the authorization behind the gate.
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', 'kafkaSchemas')
    payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'topic-1', workspace: { id: 'ws-1' } }),
      create: vi.fn().mockResolvedValue({ id: 'schema-1', type: 'value', format: 'avro' }),
    }
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace member', actor })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is unavailable while the kafkaSchemas preview feature is hidden (no DB calls)', async () => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', '')
    const r = await registerSchema(input)
    expect(r.success).toBe(false)
    expect(r.error).toContain('not available')
    expect(getActor).not.toHaveBeenCalled()
    expect(getPayload).not.toHaveBeenCalled()
    expect(payload.create).not.toHaveBeenCalled()
    expect(startWorkflow).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers', async () => {
    ;(getActor as any).mockResolvedValue(null)
    const r = await registerSchema(input)
    expect(r.success).toBe(false)
    expect(payload.create).not.toHaveBeenCalled()
  })

  it('rejects users who are not members of the topic workspace', async () => {
    ;(check as any).mockResolvedValue({ allowed: false, reason: 'not a member of this workspace', actor })
    const r = await registerSchema(input)
    expect(r).toEqual({ success: false, error: 'Not a member of this workspace' })
    expect(check).toHaveBeenCalledWith('create', { kind: 'workspace', id: 'ws-1' }, actor)
    expect(payload.create).not.toHaveBeenCalled()
    expect(startWorkflow).not.toHaveBeenCalled()
  })

  it('registers the schema for a member', async () => {
    const r = await registerSchema(input)
    expect(r.success).toBe(true)
    expect(payload.create).toHaveBeenCalledOnce()
    expect(startWorkflow).toHaveBeenCalledOnce()
  })
})

describe('platform cluster admin stubs require a platform admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getActor as any).mockResolvedValue(actor)
  })

  it.each([
    ['listClusters', () => listClusters()],
    ['registerCluster', () => registerCluster({} as any)],
    ['validateCluster', () => validateCluster('c-1')],
    ['deleteCluster', () => deleteCluster('c-1')],
  ])('%s denies a non-admin', async (_name, call) => {
    const r: any = await call()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/platform admin/i)
  })
})
