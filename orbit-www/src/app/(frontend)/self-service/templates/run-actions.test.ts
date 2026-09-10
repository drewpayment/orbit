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
    setMembershipRole: (role: string | null) => {
      membershipRole = role
    },
  }
}

let mockPayload: ReturnType<typeof makeFakePayload>['payload']
let mockSessionUser: { id: string } | null = { id: 'user-1' }
let mockPayloadUser: { id: string; role?: string } | null = { id: 'payload-user-1', role: 'member' }

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => mockPayload) }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => mockSessionUser),
  getPayloadUserFromSession: vi.fn(async () => mockPayloadUser),
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

  it('returns null for an unknown slug', async () => {
    const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
    mockPayload = env.payload
    const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

    expect(await getTemplateDefinitionByIdOrSlug('does-not-exist')).toBeNull()
  })

  it('returns null (404) for a draft slug when the caller is a plain member', async () => {
    const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
    env.setMembershipRole('member')
    mockPayload = env.payload
    const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

    expect(await getTemplateDefinitionByIdOrSlug('go-service')).toBeNull()
  })

  it('returns the row for a published slug to a plain member', async () => {
    const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
    env.setMembershipRole('member')
    mockPayload = env.payload
    const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

    const result = await getTemplateDefinitionByIdOrSlug('go-service-published')
    expect(result?.id).toBe('def-2')
  })

  it('returns null for a published slug when the caller has no workspace membership', async () => {
    const env = makeFakePayload({ 'template-definitions': [PUBLISHED_DEFINITION] })
    env.setMembershipRole(null)
    mockPayload = env.payload
    const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

    expect(await getTemplateDefinitionByIdOrSlug('go-service-published')).toBeNull()
  })

  it('returns a draft slug to a workspace owner', async () => {
    const env = makeFakePayload({ 'template-definitions': [DRAFT_DEFINITION] })
    mockPayload = env.payload
    const { getTemplateDefinitionByIdOrSlug } = await import('./run-actions')

    const result = await getTemplateDefinitionByIdOrSlug('go-service')
    expect(result?.id).toBe('def-1')
  })
})
