import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

/**
 * A small, generic in-memory fake of the Payload local API — supports the
 * subset of `find`/`findByID`/`create`/`update` shapes this module and
 * `lib/scaffolder/versions.ts` use: simple `equals`/`in` where clauses
 * (including dot-path keys like `backend.type`), `and` composition, and a
 * `-versionNumber`-style numeric sort with `limit`.
 */
function makeFakePayload(
  seed?: Record<string, Record<string, unknown>[]>,
  opts?: { membershipRole?: string | null },
) {
  const store = new Map<string, Map<string, Record<string, unknown>>>()
  let seq = 0
  // The caller's simulated role in EVERY workspace (this fake has no
  // per-workspace membership table) — null means "not a member anywhere".
  let membershipRole: string | null = opts?.membershipRole ?? 'owner'

  const col = (name: string) => {
    let m = store.get(name)
    if (!m) {
      m = new Map()
      store.set(name, m)
    }
    return m
  }

  for (const [name, docs] of Object.entries(seed ?? {})) {
    for (const doc of docs) col(name).set(String(doc.id), { ...doc })
  }

  function getPath(doc: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
      return undefined
    }, doc)
  }

  function matchesClause(doc: Record<string, unknown>, clause: Record<string, unknown>): boolean {
    return Object.entries(clause).every(([field, cond]) => {
      if (field === 'and') return (cond as Record<string, unknown>[]).every((c) => matchesClause(doc, c))
      if (field === 'or') return (cond as Record<string, unknown>[]).some((c) => matchesClause(doc, c))
      const value = getPath(doc, field)
      const c = cond as Record<string, unknown>
      if ('equals' in c) return String(value) === String(c.equals)
      if ('in' in c) return (c.in as unknown[]).map(String).includes(String(value))
      return true
    })
  }

  const find = vi.fn(async ({ collection, where, sort, limit }: Record<string, unknown>) => {
    if (collection === 'workspace-members') {
      if (!membershipRole) return { docs: [] }
      const membershipDoc = { id: 'm-1', role: membershipRole, status: 'active', workspace: WORKSPACE_ID, user: 'user-1' }
      const docs = where && !matchesClause(membershipDoc, where as Record<string, unknown>) ? [] : [membershipDoc]
      return { docs }
    }
    let docs = [...col(collection as string).values()]
    if (where) docs = docs.filter((d) => matchesClause(d, where as Record<string, unknown>))
    if (typeof sort === 'string' && sort.startsWith('-')) {
      const field = sort.slice(1)
      docs = [...docs].sort((a, b) => Number(b[field] ?? 0) - Number(a[field] ?? 0))
    }
    if (typeof limit === 'number') docs = docs.slice(0, limit)
    return { docs }
  })

  const findByID = vi.fn(async ({ collection, id }: Record<string, unknown>) => {
    const doc = col(collection as string).get(String(id))
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return { ...doc }
  })

  const create = vi.fn(async ({ collection, data }: Record<string, unknown>) => {
    const id = `${collection as string}-${++seq}`
    const doc = { id, ...(data as Record<string, unknown>) }
    col(collection as string).set(id, doc)
    return { ...doc }
  })

  const update = vi.fn(async ({ collection, id, data }: Record<string, unknown>) => {
    const existing = col(collection as string).get(String(id)) ?? { id }
    const merged = { ...existing, ...(data as Record<string, unknown>) }
    col(collection as string).set(String(id), merged)
    return { ...merged }
  })

  const payload = { find, findByID, create, update } as unknown as Payload
  return {
    payload,
    find,
    findByID,
    create,
    update,
    col,
    setMembershipRole: (role: string | null) => {
      membershipRole = role
    },
  }
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

let mockPayload: ReturnType<typeof makeFakePayload>['payload']
let mockSessionUser: { id: string } | null = { id: 'user-1' }
let mockPayloadUser: { id: string; role?: string } | null = { id: 'payload-user-1', role: 'member' }
const mockListActionsRpc = vi.fn()
const mockStartScaffolderRun = vi.fn()

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => mockPayload) }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => mockSessionUser),
  getPayloadUserFromSession: vi.fn(async () => mockPayloadUser),
}))
vi.mock('@/lib/clients/template-client', () => ({
  listActions: (...args: unknown[]) => mockListActionsRpc(...args),
  // `executeRun` (lib/actions/run.ts) is exercised for real by startDryRun/
  // startRun below (it's the point of the integration) — only its network
  // edge, the gRPC dispatch call, is stubbed.
  startScaffolderRun: (...args: unknown[]) => mockStartScaffolderRun(...args),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const WORKSPACE_ID = 'ws-1'

const DRAFT_DEFINITION = {
  id: 'def-1',
  name: 'go-service',
  workspace: WORKSPACE_ID,
  status: 'draft',
  visibility: 'workspace',
  sourceMode: 'orbit',
  createdBy: 'user-1',
  fixtures: [],
  usageCount: 0,
}

const PUBLISHED_DEFINITION = {
  ...DRAFT_DEFINITION,
  id: 'def-2',
  status: 'published',
  currentVersion: 'ver-2',
}

const DEFINITION_JSON = {
  apiVersion: 'orbit/v2',
  kind: 'Template',
  metadata: { name: 'go-service', title: 'Go service', owner: 'platform' },
  spec: {
    parameters: [
      { title: 'Basics', required: ['name'], properties: { name: { type: 'string' } } },
    ],
    steps: [],
  },
}

describe('templates/authoring-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The module keeps a 60s in-process registry cache — reset the module
    // registry so each test's dynamic `import('./authoring-actions')` gets a
    // fresh, uncached instance instead of leaking state across tests.
    vi.resetModules()
    mockSessionUser = { id: 'user-1' }
    mockPayloadUser = { id: 'payload-user-1', role: 'member' }
    mockStartScaffolderRun.mockResolvedValue({ workflowId: 'wf-test' })
  })

  // -------------------------------------------------------------------------
  // RBAC gating
  // -------------------------------------------------------------------------

  describe('RBAC gating', () => {
    it('listTemplateDefinitions returns [] for a non-owner/admin member (manage-gated)', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      // "member" role from the fake's workspace-members stub is an owner by
      // default; override find to simulate a plain member for this case.
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { listTemplateDefinitions } = await import('./authoring-actions')

      const result = await listTemplateDefinitions({ workspaceId: WORKSPACE_ID })
      expect(result).toEqual([])
    })

    it('listTemplateDefinitions returns rows for an owner', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      mockPayload = env.payload
      const { listTemplateDefinitions } = await import('./authoring-actions')

      const result = await listTemplateDefinitions({ workspaceId: WORKSPACE_ID })
      expect(result.map((d) => d.id)).toEqual(['def-1'])
    })

    it('createTemplateDefinition throws for a non-owner/admin member', async () => {
      const env = makeFakePayload()
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { createTemplateDefinition } = await import('./authoring-actions')

      await expect(
        createTemplateDefinition({ workspaceId: WORKSPACE_ID, name: 'Go service' }),
      ).rejects.toThrow(/permission/i)
    })

    it('getTemplateDefinition returns null (404) for a draft when the caller is a plain member', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinition } = await import('./authoring-actions')

      expect(await getTemplateDefinition('def-1')).toBeNull()
    })

    it('getTemplateDefinition returns the row for a published template to a plain member', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinition } = await import('./authoring-actions')

      const result = await getTemplateDefinition('def-2')
      expect(result?.id).toBe('def-2')
    })

    it('publishTemplateDefinition rejects visibility=shared for a workspace owner who is not a platform admin', async () => {
      const env = makeFakePayload({
        'template-definitions': [{ ...DRAFT_DEFINITION, visibility: 'shared', currentVersion: 'ver-1' }],
      })
      mockPayload = env.payload
      mockPayloadUser = { id: 'payload-user-1', role: 'member' } // not a platform admin
      const { publishTemplateDefinition } = await import('./authoring-actions')

      await expect(publishTemplateDefinition('def-1')).rejects.toThrow(/permission/i)
    })

    it('deprecateTemplateDefinition throws for a non-owner/admin member', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { deprecateTemplateDefinition } = await import('./authoring-actions')

      await expect(deprecateTemplateDefinition('def-1')).rejects.toThrow(/permission/i)
    })

    it('every exported mutation throws "Not authenticated" with no session', async () => {
      mockSessionUser = null
      const env = makeFakePayload()
      mockPayload = env.payload
      const { createTemplateDefinition, saveTemplateDefinitionDraft, publishTemplateDefinition } =
        await import('./authoring-actions')

      await expect(createTemplateDefinition({ workspaceId: WORKSPACE_ID, name: 'x' })).rejects.toThrow(
        /not authenticated/i,
      )
      await expect(saveTemplateDefinitionDraft('def-1', {})).rejects.toThrow(/not authenticated/i)
      await expect(publishTemplateDefinition('def-1')).rejects.toThrow(/not authenticated/i)
    })
  })

  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  describe('happy paths', () => {
    it('createTemplateDefinition creates a draft definition + version 1', async () => {
      const env = makeFakePayload()
      mockPayload = env.payload
      const { createTemplateDefinition } = await import('./authoring-actions')

      const result = await createTemplateDefinition({
        workspaceId: WORKSPACE_ID,
        name: 'Go service',
        owner: 'platform-team',
      })

      expect(result.id).toBeTruthy()
      expect(result.versionId).toBeTruthy()

      const definition = await env.payload.findByID({ collection: 'template-definitions', id: result.id })
      expect(definition.status).toBe('draft')
      expect(definition.currentVersion).toBe(result.versionId)
      expect(definition.slug).toBe('go-service')

      const version = await env.payload.findByID({
        collection: 'template-definition-versions',
        id: result.versionId,
      })
      expect(version.versionNumber).toBe(1)
      expect((version.definitionJson as { metadata: { name: string } }).metadata.name).toBe('go-service')
    })

    it('saveTemplateDefinitionDraft rejects a malformed definition before persisting', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      mockPayload = env.payload
      const { saveTemplateDefinitionDraft } = await import('./authoring-actions')

      await expect(
        saveTemplateDefinitionDraft('def-1', { apiVersion: 'orbit/v2', kind: 'NotATemplate' }),
      ).rejects.toThrow(/invalid template definition/i)
      expect(env.create).not.toHaveBeenCalled()
    })

    it('saveTemplateDefinitionDraft persists a valid definition as a new version', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      mockPayload = env.payload
      const { saveTemplateDefinitionDraft } = await import('./authoring-actions')

      const result = await saveTemplateDefinitionDraft('def-1', DEFINITION_JSON, 'add a param')
      expect(result.versionId).toBeTruthy()
      const version = await env.payload.findByID({
        collection: 'template-definition-versions',
        id: result.versionId,
      })
      expect(version.changeNote).toBe('add a param')
    })

    it('validateTemplateDefinition surfaces zod shape errors without calling the registry', async () => {
      const env = makeFakePayload()
      mockPayload = env.payload
      const { validateTemplateDefinition } = await import('./authoring-actions')

      const result = await validateTemplateDefinition({ apiVersion: 'orbit/v1' })
      expect(result.ok).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(mockListActionsRpc).not.toHaveBeenCalled()
    })

    it('validateTemplateDefinition runs the static validator against a shape-valid definition', async () => {
      mockListActionsRpc.mockResolvedValue({ actions: [] })
      const env = makeFakePayload()
      mockPayload = env.payload
      const { validateTemplateDefinition } = await import('./authoring-actions')

      const result = await validateTemplateDefinition(DEFINITION_JSON)
      expect(result.ok).toBe(true)
    })

    it('MINOR: validateTemplateDefinition reports a registry outage as a validation error, not a thrown exception', async () => {
      mockListActionsRpc.mockRejectedValue(new Error('gRPC deadline exceeded'))
      const env = makeFakePayload()
      mockPayload = env.payload
      const { validateTemplateDefinition } = await import('./authoring-actions')

      const result = await validateTemplateDefinition(DEFINITION_JSON)
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toMatch(/unavailable/i)
    })

    it('listActionRegistry maps the gRPC response and caches for subsequent calls', async () => {
      mockListActionsRpc.mockResolvedValue({
        actions: [
          {
            name: 'debug:log',
            family: 'debug',
            inputSchemaJson: '{"type":"object","properties":{"message":{"type":"string"}}}',
            outputSchemaJson: '{}',
            supportsPlan: false,
          },
        ],
      })
      const env = makeFakePayload()
      mockPayload = env.payload
      const { listActionRegistry } = await import('./authoring-actions')

      const first = await listActionRegistry()
      expect(first).toEqual([
        {
          id: 'debug:log',
          family: 'debug',
          name: 'debug:log',
          inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
          outputSchema: {},
          supportsPlan: false,
        },
      ])

      const second = await listActionRegistry()
      expect(second).toBe(first) // same cached array reference
      expect(mockListActionsRpc).toHaveBeenCalledTimes(1)
    })

    it('startDryRun creates a dryRun action-run, auto-provisions the runner action once, and dispatches', async () => {
      const env = makeFakePayload({
        'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-1' }],
        'template-definition-versions': [
          { id: 'ver-1', definition: 'def-1', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: DEFINITION_JSON },
        ],
      })
      mockPayload = env.payload
      const { startDryRun } = await import('./authoring-actions')

      const result = await startDryRun({ templateVersionId: 'ver-1', parameters: { name: 'svc' } })
      expect(result.runId).toBeTruthy()

      const run = await env.payload.findByID({ collection: 'action-runs', id: result.runId })
      expect(run.dryRun).toBe(true)
      expect(run.templateVersion).toBe('ver-1')

      const actions = (await env.payload.find({ collection: 'actions', where: {} })).docs
      const runnerActions = actions.filter(
        (a) => (a.backend as { type: string; ref: string }).ref === 'def-1',
      )
      expect(runnerActions).toHaveLength(1)

      // A second dry run reuses the same runner action instead of creating another.
      await startDryRun({ templateVersionId: 'ver-1', parameters: { name: 'svc2' } })
      const actionsAfter = (await env.payload.find({ collection: 'actions', where: {} })).docs
      expect(actionsAfter.filter((a) => (a.backend as { ref: string }).ref === 'def-1')).toHaveLength(1)
    })

    it('startDryRun uses a fixture\'s saved values when fixtureId is given', async () => {
      const env = makeFakePayload({
        'template-definitions': [
          {
            ...DRAFT_DEFINITION,
            currentVersion: 'ver-1',
            fixtures: [{ id: 'fx-1', name: 'Happy path', values: { name: 'from-fixture' } }],
          },
        ],
        'template-definition-versions': [
          { id: 'ver-1', definition: 'def-1', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: DEFINITION_JSON },
        ],
      })
      mockPayload = env.payload
      const { startDryRun } = await import('./authoring-actions')

      const result = await startDryRun({ templateVersionId: 'ver-1', parameters: {}, fixtureId: 'fx-1' })
      const run = await env.payload.findByID({ collection: 'action-runs', id: result.runId })
      expect(run.inputs).toEqual({ name: 'from-fixture' })
    })

    it('startRun refuses to run a definition that is not published', async () => {
      const env = makeFakePayload({
        'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-1' }],
        'template-definition-versions': [
          { id: 'ver-1', definition: 'def-1', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: DEFINITION_JSON },
        ],
      })
      mockPayload = env.payload
      const { startRun } = await import('./authoring-actions')

      await expect(startRun({ templateVersionId: 'ver-1', parameters: {} })).rejects.toThrow(/not published/i)
    })

    it('startRun creates a real (non-dry) run for a published definition and bumps usageCount', async () => {
      const env = makeFakePayload({
        'template-definitions': [PUBLISHED_DEFINITION],
        'template-definition-versions': [
          { id: 'ver-2', definition: 'def-2', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: DEFINITION_JSON },
        ],
      })
      mockPayload = env.payload
      const { startRun } = await import('./authoring-actions')

      const result = await startRun({ templateVersionId: 'ver-2', parameters: { name: 'svc' } })
      expect(result.status).not.toBe('awaiting-approval')

      const run = await env.payload.findByID({ collection: 'action-runs', id: result.runId })
      expect(run.dryRun).toBe(false)

      const definition = await env.payload.findByID({ collection: 'template-definitions', id: 'def-2' })
      expect(definition.usageCount).toBe(1)
    })

    describe('MAJOR 3: parameter validation against spec.parameters before persisting', () => {
      function env() {
        return makeFakePayload({
          'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-1' }],
          'template-definition-versions': [
            {
              id: 'ver-1',
              definition: 'def-1',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: DEFINITION_JSON,
            },
          ],
        })
      }

      it('rejects a missing required parameter and does not create a run', async () => {
        const e = env()
        mockPayload = e.payload
        const { startDryRun } = await import('./authoring-actions')

        await expect(startDryRun({ templateVersionId: 'ver-1', parameters: {} })).rejects.toThrow(
          /name/i,
        )
        expect(e.create.mock.calls.some((c) => c[0].collection === 'action-runs')).toBe(false)
      })

      it('rejects a parameter of the wrong type', async () => {
        const e = env()
        mockPayload = e.payload
        const { startDryRun } = await import('./authoring-actions')

        await expect(
          startDryRun({ templateVersionId: 'ver-1', parameters: { name: 12345 } }),
        ).rejects.toThrow(/name/i)
      })

      it('rejects an unknown extra parameter key', async () => {
        const e = env()
        mockPayload = e.payload
        const { startDryRun } = await import('./authoring-actions')

        await expect(
          startDryRun({
            templateVersionId: 'ver-1',
            parameters: { name: 'svc', notInSchema: 'sneaky' },
          }),
        ).rejects.toThrow(/notInSchema|additional/i)
      })

      it('accepts valid parameters', async () => {
        const e = env()
        mockPayload = e.payload
        const { startDryRun } = await import('./authoring-actions')

        const result = await startDryRun({ templateVersionId: 'ver-1', parameters: { name: 'svc' } })
        expect(result.runId).toBeTruthy()
      })

      it('startRun applies the same validation before creating a real run', async () => {
        const e = makeFakePayload({
          'template-definitions': [PUBLISHED_DEFINITION],
          'template-definition-versions': [
            {
              id: 'ver-2',
              definition: 'def-2',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: DEFINITION_JSON,
            },
          ],
        })
        mockPayload = e.payload
        const { startRun } = await import('./authoring-actions')

        await expect(startRun({ templateVersionId: 'ver-2', parameters: {} })).rejects.toThrow(/name/i)
        expect(e.create.mock.calls.some((c) => c[0].collection === 'action-runs')).toBe(false)
      })

      // Follow-up from re-review: PR #103 (feat/schema-form) unregisters a
      // ui:visibleIf-hidden field from client submission — the server-side
      // required check must not reject its absence, or every conditional
      // field becomes impossible to submit once that UI ships.
      it('does NOT reject a missing required field whose ui:visibleIf evaluates false', async () => {
        const conditionalDefinitionJson = {
          apiVersion: 'orbit/v2',
          kind: 'Template',
          metadata: { name: 'go-service', title: 'Go service', owner: 'platform' },
          spec: {
            parameters: [
              {
                title: 'Basics',
                required: ['name', 'dockerTag'],
                properties: {
                  name: { type: 'string' },
                  useDocker: { type: 'boolean' },
                  dockerTag: { type: 'string', 'ui:visibleIf': '${{ parameters.useDocker }}' },
                },
              },
            ],
            steps: [],
          },
        }
        const e = makeFakePayload({
          'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-cond' }],
          'template-definition-versions': [
            {
              id: 'ver-cond',
              definition: 'def-1',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: conditionalDefinitionJson,
            },
          ],
        })
        mockPayload = e.payload
        const { startDryRun } = await import('./authoring-actions')

        // useDocker is false/absent -> dockerTag stays hidden -> its absence
        // must NOT trigger a "required" validation error.
        const result = await startDryRun({
          templateVersionId: 'ver-cond',
          parameters: { name: 'svc', useDocker: false },
        })
        expect(result.runId).toBeTruthy()
      })

      it('DOES reject a missing required field once its ui:visibleIf evaluates true', async () => {
        const conditionalDefinitionJson = {
          apiVersion: 'orbit/v2',
          kind: 'Template',
          metadata: { name: 'go-service', title: 'Go service', owner: 'platform' },
          spec: {
            parameters: [
              {
                title: 'Basics',
                required: ['name', 'dockerTag'],
                properties: {
                  name: { type: 'string' },
                  useDocker: { type: 'boolean' },
                  dockerTag: { type: 'string', 'ui:visibleIf': '${{ parameters.useDocker }}' },
                },
              },
            ],
            steps: [],
          },
        }
        const e = makeFakePayload({
          'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-cond2' }],
          'template-definition-versions': [
            {
              id: 'ver-cond2',
              definition: 'def-1',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: conditionalDefinitionJson,
            },
          ],
        })
        mockPayload = e.payload
        const { startDryRun } = await import('./authoring-actions')

        await expect(
          startDryRun({ templateVersionId: 'ver-cond2', parameters: { name: 'svc', useDocker: true } }),
        ).rejects.toThrow(/dockerTag/i)
      })
    })

    describe('planRun authorization (published: any member; draft: manage-gated, same as startDryRun)', () => {
      it('allows a plain member to plan-run a PUBLISHED definition (side-effect-free consumer Review step)', async () => {
        const e = makeFakePayload({
          'template-definitions': [PUBLISHED_DEFINITION],
          'template-definition-versions': [
            {
              id: 'ver-2',
              definition: 'def-2',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: DEFINITION_JSON,
            },
          ],
        })
        e.setMembershipRole('member')
        mockPayload = e.payload
        const { planRun } = await import('./authoring-actions')

        const result = await planRun({ templateVersionId: 'ver-2', parameters: { name: 'svc' } })
        expect(result.runId).toBeTruthy()
      })

      it('denies a plain member plan-running a DRAFT definition (falls back to manage-gate)', async () => {
        const e = makeFakePayload({
          'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-1' }],
          'template-definition-versions': [
            {
              id: 'ver-1',
              definition: 'def-1',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: DEFINITION_JSON,
            },
          ],
        })
        e.setMembershipRole('member')
        mockPayload = e.payload
        const { planRun } = await import('./authoring-actions')

        await expect(
          planRun({ templateVersionId: 'ver-1', parameters: { name: 'svc' } }),
        ).rejects.toThrow(/permission/i)
      })

      it('still allows an owner/admin to plan-run their own DRAFT (manage-gate)', async () => {
        const e = makeFakePayload({
          'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-1' }],
          'template-definition-versions': [
            {
              id: 'ver-1',
              definition: 'def-1',
              workspace: WORKSPACE_ID,
              versionNumber: 1,
              definitionJson: DEFINITION_JSON,
            },
          ],
        })
        mockPayload = e.payload // default membershipRole: 'owner'
        const { planRun } = await import('./authoring-actions')

        const result = await planRun({ templateVersionId: 'ver-1', parameters: { name: 'svc' } })
        expect(result.runId).toBeTruthy()
      })
    })

    it('getRun redacts ui:secret parameter values before returning', async () => {
      const secretDefinitionJson = {
        ...DEFINITION_JSON,
        spec: {
          ...DEFINITION_JSON.spec,
          parameters: [
            {
              title: 'Basics',
              properties: {
                name: { type: 'string' },
                token: { type: 'string', 'ui:secret': true },
              },
            },
          ],
        },
      }
      const env = makeFakePayload({
        'template-definition-versions': [
          { id: 'ver-3', definition: 'def-3', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: secretDefinitionJson },
        ],
        'action-runs': [
          {
            id: 'run-1',
            action: 'act-1',
            workspace: WORKSPACE_ID,
            templateVersion: 'ver-3',
            status: 'succeeded',
            inputs: { name: 'svc', token: 'super-secret-value' },
          },
        ],
      })
      mockPayload = env.payload
      const { getRun } = await import('./authoring-actions')

      const run = await getRun('run-1')
      expect(run).not.toBeNull()
      expect((run!.inputs as Record<string, unknown>).name).toBe('svc')
      expect((run!.inputs as Record<string, unknown>).token).not.toBe('super-secret-value')
      expect((run!.inputs as Record<string, unknown>).token).toBe('••••••••')
    })

    it('MINOR: getRun also redacts a secret value if it leaks into steps[].output or plan', async () => {
      const secretDefinitionJson = {
        ...DEFINITION_JSON,
        spec: {
          ...DEFINITION_JSON.spec,
          parameters: [
            {
              title: 'Basics',
              properties: { token: { type: 'string', 'ui:secret': true } },
            },
          ],
        },
      }
      const env = makeFakePayload({
        'template-definition-versions': [
          {
            id: 'ver-4',
            definition: 'def-4',
            workspace: WORKSPACE_ID,
            versionNumber: 1,
            definitionJson: secretDefinitionJson,
          },
        ],
        'action-runs': [
          {
            id: 'run-2',
            action: 'act-1',
            workspace: WORKSPACE_ID,
            templateVersion: 'ver-4',
            status: 'succeeded',
            inputs: { token: 'super-secret-value' },
            steps: [{ id: 's1', status: 'succeeded', output: { echoedToken: 'super-secret-value' } }],
            plan: { changes: [{ description: 'uses super-secret-value verbatim is NOT matched (substring)' }], token: 'super-secret-value' },
            outputs: { links: [{ title: 'Config', url: 'https://x/super-secret-value' }], text: 'super-secret-value' },
          },
        ],
      })
      mockPayload = env.payload
      const { getRun } = await import('./authoring-actions')

      const run = await getRun('run-2')
      expect(run).not.toBeNull()
      const steps = run!.steps as { output?: Record<string, unknown> }[]
      expect(steps[0].output?.echoedToken).toBe('••••••••')
      const plan = run!.plan as { token?: string }
      expect(plan.token).toBe('••••••••')
      // MINOR follow-up: outputs.links/text render straight to the consumer
      // run-detail page — must be redacted too, not just inputs/steps/plan.
      const outputs = run!.outputs as { text?: string; links?: { url?: string }[] }
      expect(outputs.text).toBe('••••••••')
    })

    it('getRun also redacts a secret value if it leaks into outputs (consumer run-detail Task 17 surfaces this)', async () => {
      const secretDefinitionJson = {
        ...DEFINITION_JSON,
        spec: {
          ...DEFINITION_JSON.spec,
          parameters: [
            {
              title: 'Basics',
              properties: { token: { type: 'string', 'ui:secret': true } },
            },
          ],
        },
      }
      const env = makeFakePayload({
        'template-definition-versions': [
          {
            id: 'ver-5',
            definition: 'def-5',
            workspace: WORKSPACE_ID,
            versionNumber: 1,
            definitionJson: secretDefinitionJson,
          },
        ],
        'action-runs': [
          {
            id: 'run-3',
            action: 'act-1',
            workspace: WORKSPACE_ID,
            templateVersion: 'ver-5',
            status: 'succeeded',
            inputs: { token: 'super-secret-value' },
            outputs: { links: [{ title: 'Token', url: 'super-secret-value' }] },
          },
        ],
      })
      mockPayload = env.payload
      const { getRun } = await import('./authoring-actions')

      const run = await getRun('run-3')
      expect(run).not.toBeNull()
      const outputs = run!.outputs as { links?: { url?: string }[] }
      expect(outputs.links?.[0].url).toBe('••••••••')
    })

    it('getRun scopes to the caller\'s workspace access', async () => {
      const env = makeFakePayload({
        'action-runs': [
          { id: 'run-1', action: 'act-1', workspace: WORKSPACE_ID, status: 'succeeded', inputs: {} },
        ],
      })
      env.setMembershipRole(null)
      mockPayload = env.payload
      const { getRun } = await import('./authoring-actions')

      expect(await getRun('run-1')).toBeNull()
    })

    it('saveFixture creates then updates a fixture by id', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      mockPayload = env.payload
      const { saveFixture } = await import('./authoring-actions')

      const created = await saveFixture('def-1', { name: 'Fixture A', values: { name: 'a' } })
      expect(created.id).toBeTruthy()

      const definition = await env.payload.findByID({ collection: 'template-definitions', id: 'def-1' })
      expect(definition.fixtures).toHaveLength(1)

      await saveFixture('def-1', { id: created.id, name: 'Fixture A renamed', values: { name: 'a2' } })
      const updated = await env.payload.findByID({ collection: 'template-definitions', id: 'def-1' })
      expect(updated.fixtures).toHaveLength(1)
      expect(updated.fixtures?.[0].name).toBe('Fixture A renamed')
    })

    it('deleteFixture removes a fixture by id', async () => {
      const env = makeFakePayload({
        'template-definitions': [
          { ...DRAFT_DEFINITION, fixtures: [{ id: 'fx-1', name: 'A', values: {} }] },
        ],
      })
      mockPayload = env.payload
      const { deleteFixture } = await import('./authoring-actions')

      await deleteFixture('def-1', 'fx-1')
      const definition = await env.payload.findByID({ collection: 'template-definitions', id: 'def-1' })
      expect(definition.fixtures).toEqual([])
    })

    it('exportTemplateDefinitionYaml round-trips through importTemplateDefinitionYaml', async () => {
      const env = makeFakePayload({
        'template-definitions': [{ ...PUBLISHED_DEFINITION, currentVersion: 'ver-2' }],
        'template-definition-versions': [
          { id: 'ver-2', definition: 'def-2', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: DEFINITION_JSON },
        ],
      })
      mockPayload = env.payload
      const { exportTemplateDefinitionYaml, importTemplateDefinitionYaml } = await import('./authoring-actions')

      const yamlText = await exportTemplateDefinitionYaml('def-2')
      expect(yamlText).toContain('apiVersion: orbit/v2')

      const imported = await importTemplateDefinitionYaml(yamlText)
      expect(imported.definitionJson).toEqual(DEFINITION_JSON)
    })

    it('importTemplateDefinitionYaml throws on invalid YAML and does not persist anything', async () => {
      const env = makeFakePayload()
      mockPayload = env.payload
      const { importTemplateDefinitionYaml } = await import('./authoring-actions')

      await expect(importTemplateDefinitionYaml('not: [valid')).rejects.toThrow(/invalid yaml/i)
      expect(env.create).not.toHaveBeenCalled()
    })

    it('importTemplateDefinitionYaml throws on schema-invalid (but YAML-parseable) content', async () => {
      const env = makeFakePayload()
      mockPayload = env.payload
      const { importTemplateDefinitionYaml } = await import('./authoring-actions')

      await expect(importTemplateDefinitionYaml('foo: bar')).rejects.toThrow(/invalid template definition/i)
    })

    it('publishTemplateDefinition delegates to publishVersion and surfaces its gate failure', async () => {
      const env = makeFakePayload({
        'template-definitions': [{ ...DRAFT_DEFINITION, currentVersion: 'ver-1' }],
        'template-definition-versions': [
          { id: 'ver-1', definition: 'def-1', workspace: WORKSPACE_ID, versionNumber: 1, definitionJson: DEFINITION_JSON },
        ],
      })
      mockPayload = env.payload
      const { publishTemplateDefinition } = await import('./authoring-actions')

      // No validatedAt/dryRunRunId on the version — publishVersion's gate must reject.
      await expect(publishTemplateDefinition('def-1')).rejects.toThrow(/publish gate failed/i)
    })

    it('deprecateTemplateDefinition flips status to deprecated', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      mockPayload = env.payload
      const { deprecateTemplateDefinition } = await import('./authoring-actions')

      await deprecateTemplateDefinition('def-2')
      const definition = await env.payload.findByID({ collection: 'template-definitions', id: 'def-2' })
      expect(definition.status).toBe('deprecated')
    })
  })

  // ---------------------------------------------------------------------------
  // BUILD BREAK fix: Next.js 'use server' modules may only export async
  // functions at the top level — a class (or any other non-async-function
  // runtime export) fails the SWC server-actions transform for every
  // importer. This guard fails loudly the next time someone exports
  // something else from this file, instead of only failing at `next build`.
  // ---------------------------------------------------------------------------
  it('guard: every runtime export is an async function ("use server" constraint)', async () => {
    const mod = await import('./authoring-actions')
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function') continue // type-only exports (interfaces) are erased, not present here
      expect(value.constructor.name, `export "${name}" must be an async function, not ${value.constructor.name}`).toBe(
        'AsyncFunction',
      )
    }
  })
})
