import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import { executeRun, readLogs } from './run'
import { BUILTIN_HANDLERS } from './builtins'

/**
 * A small stateful mock of the Payload local API: collections live in in-memory
 * Maps so create → update → findByID round-trips reflect the runner's writes.
 * `find` returns an active workspace-member for any membership query (so the
 * authz role checks pass) and otherwise filters by a flat `equals` where.
 */
function makeStatefulPayload(seed?: { collections?: Record<string, Record<string, unknown>[]> }) {
  const store = new Map<string, Map<string, Record<string, unknown>>>()
  let seq = 0

  const col = (name: string) => {
    let m = store.get(name)
    if (!m) {
      m = new Map()
      store.set(name, m)
    }
    return m
  }

  for (const [name, docs] of Object.entries(seed?.collections ?? {})) {
    for (const doc of docs) col(name).set(String(doc.id), { ...doc })
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const find = vi.fn(async ({ collection }: any) => {
    if (collection === 'workspace-members') {
      // Authorize every role check with a single active member.
      return { docs: [{ id: 'm-1', role: 'owner', status: 'active' }] }
    }
    return { docs: [...col(collection).values()] }
  })
  const findByID = vi.fn(async ({ collection, id }: any) => {
    const doc = col(collection).get(String(id))
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return { ...doc }
  })
  const create = vi.fn(async ({ collection, data }: any) => {
    const id = `${collection}-${++seq}`
    const doc = { id, ...data }
    col(collection).set(id, doc)
    return { ...doc }
  })
  const update = vi.fn(async ({ collection, id, data }: any) => {
    const existing = col(collection).get(String(id)) ?? { id }
    const merged = { ...existing, ...data }
    col(collection).set(String(id), merged)
    return { ...merged }
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const payload = { find, findByID, create, update } as unknown as Payload
  return { payload, find, findByID, create, update, col }
}

const ECHO_ACTION = {
  id: 'act-echo',
  name: 'Echo',
  workspace: 'ws-1',
  backend: { type: 'builtin', ref: 'echo' },
  approvalPolicy: 'none',
  enabled: true,
}

const REGISTER_ACTION = {
  id: 'act-reg',
  name: 'Register a service',
  workspace: 'ws-1',
  backend: { type: 'builtin', ref: 'register-service' },
  approvalPolicy: 'none',
  enabled: true,
}

describe('executeRun — builtin dispatch', () => {
  it('runs the echo handler and records succeeded + outputs', async () => {
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [ECHO_ACTION],
        'action-runs': [
          { id: 'run-1', action: 'act-echo', workspace: 'ws-1', inputs: { a: 1 }, status: 'pending', logs: [] },
        ],
      },
    })

    await executeRun(payload, 'run-1')

    const run = await payload.findByID({ collection: 'action-runs', id: 'run-1' })
    expect(run.status).toBe('succeeded')
    expect(run.outputs).toEqual({ a: 1 })
    expect(readLogs(run).some((l) => /succeeded/i.test(l.message))).toBe(true)
  })

  it('register-service creates a catalog entity and records it on the run', async () => {
    const { payload, create } = makeStatefulPayload({
      collections: {
        actions: [REGISTER_ACTION],
        'action-runs': [
          {
            id: 'run-2',
            action: 'act-reg',
            workspace: 'ws-1',
            inputs: { name: 'Payments API', description: 'handles payments' },
            status: 'pending',
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-2')

    const entityCreate = create.mock.calls.find((c) => c[0].collection === 'catalog-entities')
    expect(entityCreate).toBeTruthy()
    expect(entityCreate![0].data).toMatchObject({
      name: 'Payments API',
      slug: 'payments-api',
      kind: 'service',
      workspace: 'ws-1',
      source: { type: 'manual' },
    })

    const run = await payload.findByID({ collection: 'action-runs', id: 'run-2' })
    expect(run.status).toBe('succeeded')
    expect(run.entity).toBeTruthy()
    expect((run.outputs as { entityId?: string }).entityId).toBe(run.entity)
  })

  it('fails the run when the builtin handler id is unknown', async () => {
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [{ ...ECHO_ACTION, id: 'act-x', backend: { type: 'builtin', ref: 'does-not-exist' } }],
        'action-runs': [
          { id: 'run-3', action: 'act-x', workspace: 'ws-1', inputs: {}, status: 'pending', logs: [] },
        ],
      },
    })

    await executeRun(payload, 'run-3')

    const run = await payload.findByID({ collection: 'action-runs', id: 'run-3' })
    expect(run.status).toBe('failed')
    expect(String(run.error)).toMatch(/does-not-exist/)
  })
})

describe('executeRun — deferred Temporal backends', () => {
  it('leaves a kafka-provision run pending with a deferred log (does not execute)', async () => {
    const { payload, create } = makeStatefulPayload({
      collections: {
        actions: [
          { id: 'act-k', name: 'Kafka', workspace: 'ws-1', backend: { type: 'kafka-provision', ref: 'topic' }, enabled: true },
        ],
        'action-runs': [
          { id: 'run-4', action: 'act-k', workspace: 'ws-1', inputs: { topic: 't' }, status: 'pending', logs: [] },
        ],
      },
    })

    await executeRun(payload, 'run-4')

    const run = await payload.findByID({ collection: 'action-runs', id: 'run-4' })
    expect(run.status).toBe('pending')
    expect(readLogs(run).some((l) => /deferred to the ActionDispatch workflow/i.test(l.message))).toBe(true)
    // No side-effect rows were written.
    expect(create.mock.calls.some((c) => c[0].collection === 'catalog-entities')).toBe(false)
  })
})

describe('builtin handlers', () => {
  const baseCtx = () => ({
    payload: makeStatefulPayload().payload,
    workspaceId: 'ws-1',
    inputs: {} as Record<string, unknown>,
    log: vi.fn(),
  })

  it('register-service throws without a name', async () => {
    const ctx = baseCtx()
    await expect(BUILTIN_HANDLERS['register-service'](ctx)).rejects.toThrow(/name/i)
  })

  it('echo returns inputs as outputs', async () => {
    const ctx = { ...baseCtx(), inputs: { hello: 'world' } }
    const result = await BUILTIN_HANDLERS.echo(ctx)
    expect(result.outputs).toEqual({ hello: 'world' })
    expect(result.entityId).toBeUndefined()
  })

  it('noop aliases echo', () => {
    expect(BUILTIN_HANDLERS.noop).toBe(BUILTIN_HANDLERS.echo)
  })
})

// ---------------------------------------------------------------------------
// runAction approval branching — mock getPayload + the session user.
// ---------------------------------------------------------------------------

let mockPayload: ReturnType<typeof makeStatefulPayload>['payload']

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => mockPayload) }))
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'user-1' })) }))

describe('runAction — approval branching', () => {
  beforeEach(() => vi.clearAllMocks())

  it('policy "none" creates a run and executes it (succeeded)', async () => {
    const env = makeStatefulPayload({ collections: { actions: [ECHO_ACTION] } })
    mockPayload = env.payload
    const { runAction } = await import('@/app/(frontend)/self-service/actions')

    const result = await runAction({ actionId: 'act-echo', inputs: {} })
    expect(result.status).toBe('succeeded')

    const run = await env.payload.findByID({ collection: 'action-runs', id: result.runId })
    expect(run.status).toBe('succeeded')
  })

  it('policy "workspace-admin" parks the run as awaiting-approval (does not execute)', async () => {
    const env = makeStatefulPayload({
      collections: {
        actions: [{ ...REGISTER_ACTION, id: 'act-gated', approvalPolicy: 'workspace-admin' }],
      },
    })
    mockPayload = env.payload
    const { runAction } = await import('@/app/(frontend)/self-service/actions')

    const result = await runAction({ actionId: 'act-gated', inputs: { name: 'Svc' } })
    expect(result.status).toBe('awaiting-approval')

    // Nothing executed: no catalog entity was created by register-service.
    expect(env.create.mock.calls.some((c) => c[0].collection === 'catalog-entities')).toBe(false)
  })
})
