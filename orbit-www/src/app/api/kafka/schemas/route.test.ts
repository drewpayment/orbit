/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  authorize: vi.fn(),
  findByID: vi.fn(),
  registerSchema: vi.fn(),
  listSchemas: vi.fn(),
  checkSchemaCompatibility: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ findByID: mocks.findByID })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', async () => (await import('@/lib/authz/route-test-utils')).makeAuthzMock(mocks))
vi.mock('@/app/(frontend)/workspaces/[slug]/kafka/actions', () => ({
  registerSchema: mocks.registerSchema,
  listSchemas: mocks.listSchemas,
  checkSchemaCompatibility: mocks.checkSchemaCompatibility,
}))

import { FakeAuthzError } from '@/lib/authz/route-test-utils'

const schemas = await import('./route')
const compat = await import('./compatibility/route')

const body = { topicId: 't1', type: 'value', format: 'avro', content: '{}' }
const post = (url: string, b: unknown = body) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  })
const get = () => new NextRequest('http://localhost/api/kafka/schemas?topicId=t1')

describe('kafka schema routes: workspace authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActor.mockResolvedValue({ payloadId: 'p1', betterAuthId: 'b1', isPlatformAdmin: false })
    mocks.authorize.mockResolvedValue({})
    mocks.findByID.mockResolvedValue({ id: 't1', workspace: 'ws-1' })
    mocks.registerSchema.mockResolvedValue({ success: true, schema: { id: 's1' } })
    mocks.listSchemas.mockResolvedValue({ success: true, schemas: [] })
    mocks.checkSchemaCompatibility.mockResolvedValue({ success: true, compatible: true })
  })

  const cases: Array<[string, () => Promise<Response>, ReturnType<typeof vi.fn>]> = [
    ['POST /schemas', () => schemas.POST(post('/api/kafka/schemas')), mocks.registerSchema],
    ['GET /schemas', () => schemas.GET(get()), mocks.listSchemas],
    ['POST /schemas/compatibility', () => compat.POST(post('/api/kafka/schemas/compatibility')), mocks.checkSchemaCompatibility],
  ]

  it.each(cases)('%s returns 401 when unauthenticated', async (_n, call, action) => {
    mocks.getActor.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(action).not.toHaveBeenCalled()
  })

  it.each(cases)('%s returns 403 for a non-member of the topic workspace', async (_n, call, action) => {
    mocks.authorize.mockRejectedValue(new FakeAuthzError())
    expect((await call()).status).toBe(403)
    expect(action).not.toHaveBeenCalled()
  })

  it.each(cases)('%s returns 404 when the topic does not exist', async (_n, call, action) => {
    mocks.findByID.mockRejectedValue(new Error('Not Found'))
    expect((await call()).status).toBe(404)
    expect(action).not.toHaveBeenCalled()
  })

  it.each(cases)('%s proceeds for a workspace member and authorizes against the topic workspace', async (_n, call, action) => {
    expect((await call()).status).toBe(200)
    expect(action).toHaveBeenCalled()
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(String),
      { kind: 'workspace', id: 'ws-1' },
      expect.anything(),
    )
  })

  it('resolves a populated workspace relationship object', async () => {
    mocks.findByID.mockResolvedValue({ id: 't1', workspace: { id: 'ws-9' } })
    await schemas.POST(post('/api/kafka/schemas'))
    expect(mocks.authorize).toHaveBeenCalledWith('create', { kind: 'workspace', id: 'ws-9' }, expect.anything())
  })
})
