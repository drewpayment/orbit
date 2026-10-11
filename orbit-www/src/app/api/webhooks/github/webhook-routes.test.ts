/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

const mocks = vi.hoisted(() => {
  // Routes decrypt webhook secrets via lib/encryption, which needs a key at import.
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
  return {
  find: vi.fn(),
  update: vi.fn(),
  findByID: vi.fn(),
  connect: vi.fn(),
  signal: vi.fn(),
  start: vi.fn(),
  }
})

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ find: mocks.find, update: mocks.update, findByID: mocks.findByID })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@temporalio/client', () => ({
  Connection: { connect: mocks.connect },
  Client: class {
    workflow = { getHandle: () => ({ signal: mocks.signal }), start: mocks.start }
  },
}))
vi.mock('@/lib/github-manifest', () => ({
  fetchManifestContent: vi.fn().mockRejectedValue(new Error('manifest unavailable')),
  parseGitHubUrl: vi.fn(),
}))
vi.mock('@/lib/github/octokit', () => ({ createInstallationToken: vi.fn() }))

const routes = {
  'spec-sync': await import('./spec-sync/route'),
  'app-sync': await import('./app-sync/route'),
  'template-sync': await import('./template-sync/route'),
}

const sign = (body: string, secret: string) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

const bodyObj = {
  ref: 'refs/heads/main',
  after: 'a',
  before: 'b',
  repository: { full_name: 'acme/svc', default_branch: 'main' },
  commits: [{ added: ['openapi.yaml'], modified: [], removed: [] }],
}
const body = JSON.stringify(bodyObj)

function req(name: string, signature: string | null) {
  const headers: Record<string, string> = { 'X-GitHub-Event': 'push' }
  if (signature !== null) headers['X-Hub-Signature-256'] = signature
  return new NextRequest(`http://localhost/api/webhooks/github/${name}`, { method: 'POST', headers, body })
}

describe.each(Object.keys(routes) as Array<keyof typeof routes>)('webhooks/github/%s signature ordering', (name) => {
  const idKey = name === 'template-sync' ? 'templateId' : 'appId'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.connect.mockResolvedValue({})
    mocks.signal.mockResolvedValue(undefined)
    mocks.start.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue({})
    mocks.findByID.mockRejectedValue(new Error('not found'))
    mocks.find.mockResolvedValue({
      docs: [
        { id: 'with-secret', webhookSecret: 'good', repository: { owner: 'acme', name: 'svc' }, workspace: 'w1', slug: 's' },
        { id: 'other-secret', webhookSecret: 'other' },
        { id: 'no-secret', webhookSecret: null },
      ],
    })
  })

  it('401 when the signature header is missing', async () => {
    const res = await routes[name].POST(req(name, null))
    expect(res.status).toBe(401)
  })

  it('wrong signature: generic 401, no app/template details, no Temporal connection, no writes', async () => {
    const res = await routes[name].POST(req(name, sign(body, 'attacker')))
    expect(res.status).toBe(401)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'Invalid signature' })
    for (const leaked of ['with-secret', 'other-secret', 'no-secret', 'No webhook secret', 'results']) {
      expect(text).not.toContain(leaked)
    }
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('malformed (short) signature does not 500', async () => {
    const res = await routes[name].POST(req(name, 'sha256=abc'))
    expect(res.status).toBe(401)
  })

  it('no candidates for the repo: generic 200 {ok:true}, no details, no Temporal, no writes', async () => {
    mocks.find.mockResolvedValue({ docs: [] })
    const res = await routes[name].POST(req(name, sign(body, 'attacker')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('valid signature: processes only the verified candidate and reports only it', async () => {
    const res = await routes[name].POST(req(name, sign(body, 'good')))
    expect(res.status).toBe(200)
    const json = await res.json()
    const ids = (json.results as Array<Record<string, string>>).map((r) => r[idKey])
    expect(ids).toEqual(['with-secret'])
    if (name === 'spec-sync') expect(mocks.connect).toHaveBeenCalledTimes(1)
  })
})

describe.each(Object.keys(routes) as Array<keyof typeof routes>)('webhooks/github/%s with secrets encrypted at rest', (name) => {
  const idKey = name === 'template-sync' ? 'templateId' : 'appId'
  let stored: string
  let corrupt: string

  beforeEach(async () => {
    vi.clearAllMocks()
    const { encryptSecretValue } = await import('@/lib/encryption/secret-fields')
    stored = encryptSecretValue('good') as string
    corrupt = stored.slice(0, -2) + (stored.endsWith('00') ? 'ff' : '00')
    mocks.connect.mockResolvedValue({})
    mocks.signal.mockResolvedValue(undefined)
    mocks.start.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue({})
    mocks.findByID.mockRejectedValue(new Error('not found'))
    mocks.find.mockImplementation(async () => ({
      docs: [
        { id: 'enc', webhookSecret: stored, repository: { owner: 'acme', name: 'svc' }, workspace: 'w1', slug: 's' },
        { id: 'broken', webhookSecret: corrupt },
      ],
    }))
  })

  it('verifies the HMAC against the decrypted secret; an undecryptable one never verifies', async () => {
    const res = await routes[name].POST(req(name, sign(body, 'good')))
    expect(res.status).toBe(200)
    const ids = ((await res.json()).results as Array<Record<string, string>>).map((r) => r[idKey])
    expect(ids).toEqual(['enc'])
  })

  it('a signature computed with the stored ciphertext is rejected', async () => {
    const res = await routes[name].POST(req(name, sign(body, stored)))
    expect(res.status).toBe(401)
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('a signature over the corrupt candidate\'s ciphertext is rejected (not skipped past verification)', async () => {
    const res = await routes[name].POST(req(name, sign(body, corrupt)))
    expect(res.status).toBe(401)
  })
})
