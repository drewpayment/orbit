import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

/**
 * Minimal fake of the Payload local API for `run-actions.ts` — same shape
 * as `authoring-actions.test.ts`'s fake (kept independent/duplicated
 * rather than shared, to avoid coupling this small consumer-facing module's
 * tests to that larger file's fixture).
 */
function makeFakePayload(
  seed?: Record<string, Record<string, unknown>[]>,
  opts?: { membershipRole?: string | null },
) {
  const store = new Map<string, Map<string, Record<string, unknown>>>()
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

  function matchesClause(doc: Record<string, unknown>, clause: Record<string, unknown>): boolean {
    return Object.entries(clause).every(([field, cond]) => {
      if (field === 'and') return (cond as Record<string, unknown>[]).every((c) => matchesClause(doc, c))
      if (field === 'or') return (cond as Record<string, unknown>[]).some((c) => matchesClause(doc, c))
      const value = (doc as Record<string, unknown>)[field]
      const c = cond as Record<string, unknown>
      if ('equals' in c) return String(value) === String(c.equals)
      if ('in' in c) return (c.in as unknown[]).map(String).includes(String(value))
      return true
    })
  }

  const find = vi.fn(async ({ collection, where, limit }: Record<string, unknown>) => {
    if (collection === 'workspace-members') {
      if (!membershipRole) return { docs: [] }
      const membershipDoc = { id: 'm-1', role: membershipRole, status: 'active', workspace: WORKSPACE_ID, user: 'user-1' }
      const docs = where && !matchesClause(membershipDoc, where as Record<string, unknown>) ? [] : [membershipDoc]
      return { docs }
    }
    let docs = [...col(collection as string).values()]
    if (where) docs = docs.filter((d) => matchesClause(d, where as Record<string, unknown>))
    if (typeof limit === 'number') docs = docs.slice(0, limit)
    return { docs }
  })

  const findByID = vi.fn(async ({ collection, id }: Record<string, unknown>) => {
    const doc = col(collection as string).get(String(id))
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return { ...doc }
  })

  const payload = { find, findByID } as unknown as Payload
  return {
    payload,
    find,
    findByID,
    setMembershipRole: (role: string | null) => {
      membershipRole = role
    },
  }
}

let mockPayload: ReturnType<typeof makeFakePayload>['payload']
let mockSessionUser: { id: string; email?: string } | null = { id: 'user-1' }
let mockPayloadUser: { id: string; role?: string } | null = { id: 'payload-user-1', role: 'member' }

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => mockPayload) }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => mockSessionUser),
  getPayloadUserFromSession: vi.fn(async () => mockPayloadUser),
}))
vi.mock('@/lib/clients/template-client', () => ({
  resolveScaffolderApproval: vi.fn(async () => ({})),
}))

const WORKSPACE_ID = 'ws-1'

const DRAFT_DEFINITION = {
  id: 'def-1',
  name: 'go-service',
  slug: 'go-service',
  workspace: WORKSPACE_ID,
  status: 'draft',
  visibility: 'workspace',
}

const PUBLISHED_DEFINITION = {
  ...DRAFT_DEFINITION,
  id: 'def-2',
  slug: 'go-service-published',
  status: 'published',
  currentVersion: 'ver-2',
}

describe('templates/run-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionUser = { id: 'user-1' }
    mockPayloadUser = { id: 'payload-user-1', role: 'member' }
  })

  describe('getTemplateDefinitionByIdOrSlug', () => {
    it('returns null for an identifier that matches neither an id nor a slug', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      expect(await getTemplateDefinitionByIdOrSlug('does-not-exist')).toBeNull()
    })

    it('returns null (404) for a draft identifier when the caller is a plain member', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      expect(await getTemplateDefinitionByIdOrSlug('go-service')).toBeNull()
      expect(await getTemplateDefinitionByIdOrSlug('def-1')).toBeNull()
    })

    it('returns the row for a published SLUG to a plain member', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      const result = await getTemplateDefinitionByIdOrSlug('go-service-published')
      expect(result?.id).toBe('def-2')
    })

    it('returns the row for a published ID (resolved via findByID, not the slug find) to a plain member', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      const result = await getTemplateDefinitionByIdOrSlug('def-2')
      expect(result?.id).toBe('def-2')
      expect(env.findByID).toHaveBeenCalledWith(
        expect.objectContaining({ collection: 'template-definitions', id: 'def-2' }),
      )
    })

    it('falls back to a slug lookup when the identifier does not match any id', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      const result = await getTemplateDefinitionByIdOrSlug('go-service-published')
      expect(result?.id).toBe('def-2')
      // findByID was tried first (and threw, per the fake's not-found behavior) before falling back.
      expect(env.findByID).toHaveBeenCalled()
      expect(env.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: { equals: 'go-service-published' } } }),
      )
    })

    it('returns null for a published identifier when the caller has no workspace membership', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      env.setMembershipRole(null)
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      expect(await getTemplateDefinitionByIdOrSlug('go-service-published')).toBeNull()
      expect(await getTemplateDefinitionByIdOrSlug('def-2')).toBeNull()
    })

    it('returns a draft identifier (by id or by slug) to a workspace owner', async () => {
      const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
      mockPayload = env.payload
      const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

      expect((await getTemplateDefinitionByIdOrSlug('go-service'))?.id).toBe('def-1')
      expect((await getTemplateDefinitionByIdOrSlug('def-1'))?.id).toBe('def-1')
    })
  })

  describe('getTemplateDefinitionBySlug (back-compat alias)', () => {
    it('is the same function as getTemplateDefinitionByIdOrSlug', async () => {
      const { getTemplateDefinitionBySlug, getTemplateDefinitionByIdOrSlug } = await import('./run-actions')
      expect(getTemplateDefinitionBySlug).toBe(getTemplateDefinitionByIdOrSlug)
    })

    it('still resolves a slug', async () => {
      const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      const { getTemplateDefinitionBySlug } = await import('./run-actions')

      expect((await getTemplateDefinitionBySlug('go-service-published'))?.id).toBe('def-2')
    })
  })

  describe('resolveScaffolderApproval', () => {
    const RUN = { id: 'run-1', workspace: WORKSPACE_ID, workflowId: 'scaffolder-run-run-1' }
    const GATE = {
      id: 'gate-1',
      workflowId: 'scaffolder-run-run-1',
      runId: 'run-1',
      approvalId: 'run-1:gate',
      status: 'pending',
      title: 'Approval',
      payload: { message: 'Please review', approvers: ['approver@example.com'], stepId: 'gate' },
    }

    it('calls the RPC when the caller is a workspace owner/admin', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [GATE] })
      env.setMembershipRole('owner')
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')
      const { resolveScaffolderApproval: rpc } = await import('@/lib/clients/template-client')

      const result = await resolveScaffolderApproval('run-1', 'run-1:gate', true, 'lgtm')

      expect(result).toEqual({ ok: true, runId: 'run-1' })
      expect(rpc).toHaveBeenCalledWith({
        workflowId: 'scaffolder-run-run-1',
        approvalId: 'run-1:gate',
        approved: true,
        approverId: 'user-1',
        comment: 'lgtm',
        workspaceId: WORKSPACE_ID,
      })
    })

    it('signals the gate row\'s OWN workflowId, not the root run\'s, for a fetch:template-nested gate', async () => {
      // A gate opened inside a fetch:template-nested child workflow carries
      // the root run's id (runId) but the CHILD's own real Temporal
      // workflow id (workflowId) — deliberately different from the root
      // run's action-runs doc, which is what run.workflowId would give.
      const nestedGate = {
        ...GATE,
        workflowId: 'scaffolder-run-run-1-compose',
        approvalId: 'run-1:compose:gate',
      }
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [nestedGate] })
      env.setMembershipRole('owner')
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')
      const { resolveScaffolderApproval: rpc } = await import('@/lib/clients/template-client')

      const result = await resolveScaffolderApproval('run-1', 'run-1:compose:gate', true)

      expect(result).toEqual({ ok: true, runId: 'run-1' })
      expect(rpc).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'scaffolder-run-run-1-compose' }),
      )
    })

    it('surfaces an RPC failure as {ok: false, errors} instead of throwing', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [GATE] })
      env.setMembershipRole('owner')
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { resolveScaffolderApproval: rpc } = await import('@/lib/clients/template-client')
      vi.mocked(rpc).mockRejectedValueOnce(
        new Error('[permission_denied] token has no workspace claim for a workspace-scoped request'),
      )
      const { resolveScaffolderApproval } = await import('./run-actions')

      const result = await resolveScaffolderApproval('run-1', 'run-1:gate', true)

      expect(result.ok).toBe(false)
      expect(result.runId).toBe('run-1')
      expect(result.errors?.[0]).toMatch(/workspace claim/i)
    })

    it('calls the RPC when the caller is listed by email in approvers, even as a plain member', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [GATE] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      mockSessionUser = { id: 'user-9', email: 'approver@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')
      const { resolveScaffolderApproval: rpc } = await import('@/lib/clients/template-client')

      await resolveScaffolderApproval('run-1', 'run-1:gate', true)
      expect(rpc).toHaveBeenCalled()
    })

    it('rejects a plain member who is neither owner/admin nor a listed approver', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [GATE] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      mockSessionUser = { id: 'user-2', email: 'nobody@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')
      const { resolveScaffolderApproval: rpc } = await import('@/lib/clients/template-client')

      await expect(resolveScaffolderApproval('run-1', 'run-1:gate', true)).rejects.toThrow(/permission/i)
      expect(rpc).not.toHaveBeenCalled()
    })

    it('throws when the run does not exist', async () => {
      const env = makeFakePayload({ 'pending-approvals': [GATE] })
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')

      await expect(resolveScaffolderApproval('run-1', 'run-1:gate', true)).rejects.toThrow(/not found/i)
    })

    it('throws when the run has not been dispatched (no workflowId)', async () => {
      const env = makeFakePayload({ 'action-runs': [{ id: 'run-1', workspace: WORKSPACE_ID }] })
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')

      await expect(resolveScaffolderApproval('run-1', 'run-1:gate', true)).rejects.toThrow(/not.*dispatched/i)
    })

    it('throws when no matching pending-approvals gate exists', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN] })
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { resolveScaffolderApproval } = await import('./run-actions')

      await expect(resolveScaffolderApproval('run-1', 'run-1:gate', true)).rejects.toThrow(/gate not found/i)
    })
  })

  describe('getScaffolderApprovalGates', () => {
    const RUN = { id: 'run-1', workspace: WORKSPACE_ID, workflowId: 'scaffolder-run-run-1' }
    const GATE = {
      id: 'gate-1',
      workflowId: 'scaffolder-run-run-1',
      runId: 'run-1',
      approvalId: 'run-1:gate',
      status: 'pending',
      title: 'Approval',
      payload: { message: 'Please review', approvers: ['approver@example.com'], stepId: 'gate' },
    }

    it('returns the gate keyed by step id, with canApprove computed for the viewer', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [GATE] })
      env.setMembershipRole('owner')
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { getScaffolderApprovalGates } = await import('./run-actions')

      const gates = await getScaffolderApprovalGates('run-1')
      expect(gates.gate).toEqual({
        approvalId: 'run-1:gate',
        message: 'Please review',
        approvers: ['approver@example.com'],
        canApprove: true,
      })
    })

    it('reports canApprove=false for a plain member not listed as an approver', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN], 'pending-approvals': [GATE] })
      env.setMembershipRole('member')
      mockPayload = env.payload
      // Fixture's fake workspace-members membership doc is hardcoded to
      // user-1 (see makeFakePayload's `find`) — reuse that id here so
      // canRunTemplateDefinition (member-and-above) still matches, isolating
      // this test to the approver-list check alone.
      mockSessionUser = { id: 'user-1', email: 'nobody@example.com' }
      const { getScaffolderApprovalGates } = await import('./run-actions')

      const gates = await getScaffolderApprovalGates('run-1')
      expect(gates.gate?.canApprove).toBe(false)
    })

    it('returns {} when the run does not exist', async () => {
      const env = makeFakePayload({})
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { getScaffolderApprovalGates } = await import('./run-actions')

      expect(await getScaffolderApprovalGates('run-1')).toEqual({})
    })

    it('returns {} when there are no open gates for the run', async () => {
      const env = makeFakePayload({ 'action-runs': [RUN] })
      mockPayload = env.payload
      mockSessionUser = { id: 'user-1', email: 'owner@example.com' }
      const { getScaffolderApprovalGates } = await import('./run-actions')

      expect(await getScaffolderApprovalGates('run-1')).toEqual({})
    })
  })
})
