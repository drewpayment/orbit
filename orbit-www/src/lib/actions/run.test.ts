import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import { executeRun, readLogs } from './run'
import { BUILTIN_HANDLERS } from './builtins'

const mockStartScaffolderRun = vi.fn()
vi.mock('@/lib/clients/template-client', () => ({
  startScaffolderRun: (...args: unknown[]) => mockStartScaffolderRun(...args),
}))

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

// ---------------------------------------------------------------------------
// executeRun — scaffolder dispatch (phase-1 plan §9.2)
// ---------------------------------------------------------------------------

const SCAFFOLDER_ACTION = {
  id: 'act-scaffolder',
  name: 'Template: Go service',
  workspace: 'ws-1',
  backend: { type: 'scaffolder', ref: 'def-1' },
  approvalPolicy: 'none',
  enabled: true,
}

const PUBLISHED_TEMPLATE_DEFINITION = {
  id: 'def-1',
  name: 'go-service',
  workspace: 'ws-1',
  status: 'published',
  currentVersion: 'ver-1',
}

const DRAFT_TEMPLATE_DEFINITION = {
  ...PUBLISHED_TEMPLATE_DEFINITION,
  status: 'draft',
}

describe('executeRun — scaffolder dispatch', () => {
  beforeEach(() => {
    mockStartScaffolderRun.mockReset()
  })

  it('calls StartScaffolderRun with the RUN\'S RECORDED templateVersion + inputs, writes workflowId, leaves status running', async () => {
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-123' })
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [SCAFFOLDER_ACTION],
        // currentVersion has since moved on (v2) — the run must still use
        // the version it was created/reviewed against (ver-1), not whatever
        // is current at dispatch time (MAJOR 4).
        'template-definitions': [{ ...PUBLISHED_TEMPLATE_DEFINITION, currentVersion: 'ver-2' }],
        'action-runs': [
          {
            id: 'run-scaffolder-1',
            action: 'act-scaffolder',
            workspace: 'ws-1',
            templateVersion: 'ver-1',
            inputs: { name: 'payments-api' },
            status: 'pending',
            dryRun: false,
            triggeredBy: 'user-42',
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-1')

    expect(mockStartScaffolderRun).toHaveBeenCalledWith({
      runId: 'run-scaffolder-1',
      definitionVersionId: 'ver-1',
      workspaceId: 'ws-1',
      userId: 'user-42',
      parameters: { name: 'payments-api' },
      dryRun: false,
    })

    const run = await payload.findByID({ collection: 'action-runs', id: 'run-scaffolder-1' })
    // The worker owns terminal status — the dispatcher leaves it running.
    expect(run.status).toBe('running')
    expect(run.workflowId).toBe('wf-123')
  })

  it('dry runs dispatch even when the definition is still draft (dryRun bypasses the published gate)', async () => {
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-456' })
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [SCAFFOLDER_ACTION],
        'template-definitions': [DRAFT_TEMPLATE_DEFINITION],
        'action-runs': [
          {
            id: 'run-scaffolder-2',
            action: 'act-scaffolder',
            workspace: 'ws-1',
            templateVersion: 'ver-1',
            inputs: {},
            status: 'pending',
            dryRun: true,
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-2')

    expect(mockStartScaffolderRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
  })

  it('BLOCKER 1: refuses to dispatch a real (non-dry) run against a draft/unpublished definition', async () => {
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-should-not-be-called' })
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [SCAFFOLDER_ACTION],
        'template-definitions': [DRAFT_TEMPLATE_DEFINITION],
        'action-runs': [
          {
            id: 'run-scaffolder-3',
            action: 'act-scaffolder',
            workspace: 'ws-1',
            templateVersion: 'ver-1',
            inputs: {},
            status: 'pending',
            dryRun: false,
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-3')

    expect(mockStartScaffolderRun).not.toHaveBeenCalled()
    const run = await payload.findByID({ collection: 'action-runs', id: 'run-scaffolder-3' })
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/published/i)
  })

  it('BLOCKER 1: refuses to dispatch when the run has no templateVersion at all (e.g. dispatched via the generic Actions catalog)', async () => {
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-should-not-be-called' })
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [SCAFFOLDER_ACTION],
        'template-definitions': [PUBLISHED_TEMPLATE_DEFINITION],
        'action-runs': [
          {
            id: 'run-scaffolder-4',
            action: 'act-scaffolder',
            workspace: 'ws-1',
            // no templateVersion — this run did NOT come through startDryRun/startRun.
            inputs: {},
            status: 'pending',
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-4')

    expect(mockStartScaffolderRun).not.toHaveBeenCalled()
    const run = await payload.findByID({ collection: 'action-runs', id: 'run-scaffolder-4' })
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/templateVersion/i)
  })

  it('BLOCKER 2: refuses to dispatch when the template-definition belongs to a DIFFERENT workspace than the run', async () => {
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-should-not-be-called' })
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [SCAFFOLDER_ACTION],
        'template-definitions': [{ ...PUBLISHED_TEMPLATE_DEFINITION, workspace: 'ws-OTHER-TENANT' }],
        'action-runs': [
          {
            id: 'run-scaffolder-5',
            action: 'act-scaffolder',
            workspace: 'ws-1', // the run's own (correct) tenant
            templateVersion: 'ver-1',
            inputs: {},
            status: 'pending',
            dryRun: false,
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-5')

    expect(mockStartScaffolderRun).not.toHaveBeenCalled()
    const run = await payload.findByID({ collection: 'action-runs', id: 'run-scaffolder-5' })
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/workspace/i)
  })

  it('BLOCKER 2: refuses to dispatch when the ACTION belongs to a different workspace than the definition', async () => {
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-should-not-be-called' })
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [{ ...SCAFFOLDER_ACTION, workspace: 'ws-ANOTHER-TENANT' }],
        'template-definitions': [PUBLISHED_TEMPLATE_DEFINITION],
        'action-runs': [
          {
            id: 'run-scaffolder-6',
            action: 'act-scaffolder',
            workspace: 'ws-ANOTHER-TENANT',
            templateVersion: 'ver-1',
            inputs: {},
            status: 'pending',
            dryRun: false,
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-6')

    expect(mockStartScaffolderRun).not.toHaveBeenCalled()
    const run = await payload.findByID({ collection: 'action-runs', id: 'run-scaffolder-6' })
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/workspace/i)
  })

  it('fails the run when StartScaffolderRun throws', async () => {
    mockStartScaffolderRun.mockRejectedValue(new Error('worker unreachable'))
    const { payload } = makeStatefulPayload({
      collections: {
        actions: [SCAFFOLDER_ACTION],
        'template-definitions': [PUBLISHED_TEMPLATE_DEFINITION],
        'action-runs': [
          {
            id: 'run-scaffolder-7',
            action: 'act-scaffolder',
            workspace: 'ws-1',
            templateVersion: 'ver-1',
            inputs: {},
            status: 'pending',
            dryRun: false,
            logs: [],
          },
        ],
      },
    })

    await executeRun(payload, 'run-scaffolder-7')

    const run = await payload.findByID({ collection: 'action-runs', id: 'run-scaffolder-7' })
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/worker unreachable/)
  })
})

// ---------------------------------------------------------------------------
// runAction — BLOCKER 1(c): scaffolder-backed actions must not be runnable
// through the generic Actions catalog dispatch path.
// ---------------------------------------------------------------------------

describe('runAction — rejects scaffolder-backed actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects with a clear error instead of creating a run', async () => {
    const env = makeStatefulPayload({ collections: { actions: [SCAFFOLDER_ACTION] } })
    mockPayload = env.payload
    const { runAction } = await import('@/app/(frontend)/self-service/actions')

    await expect(runAction({ actionId: 'act-scaffolder', inputs: {} })).rejects.toThrow(
      /template/i,
    )
    expect(env.create.mock.calls.some((c) => c[0].collection === 'action-runs')).toBe(false)
  })
})
