/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

const find = vi.fn()
const findByID = vi.fn()
const update = vi.fn()
vi.mock('payload', () => ({ getPayload: async () => ({ find, findByID, update }) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { NextRequest } from 'next/server'
import { encryptSecretValue } from '@/lib/encryption/secret-fields'
import { POST } from './route'

const SECRET = 'whsec_template_secret'
const body = JSON.stringify({
  ref: 'refs/heads/main',
  repository: { full_name: 'acme/tpl', default_branch: 'main' },
})
const sign = (secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
const post = (signature: string) =>
  POST(
    new NextRequest('http://localhost/api/webhooks/github/template-sync', {
      method: 'POST',
      body,
      headers: { 'X-Hub-Signature-256': signature, 'X-GitHub-Event': 'push' },
    }),
  )

describe('POST /api/webhooks/github/template-sync', () => {
  beforeEach(() => {
    find.mockReset()
    findByID.mockReset()
    update.mockReset()
    // sync proceeds past signature -> no installation -> deterministic error
    find.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'templates'
        ? { docs: [{ id: 't1', webhookSecret: currentSecret }] }
        : { docs: [] },
    )
    findByID.mockResolvedValue({ id: 't1', workspace: 'ws1', repoUrl: 'https://github.com/acme/tpl' })
  })
  let currentSecret: string

  it('accepts a correctly signed push when the stored secret is encrypted', async () => {
    currentSecret = encryptSecretValue(SECRET) as string
    const res = await post(sign(SECRET))
    const json = await res.json()
    // Signature accepted: the sync ran and stopped at the (mocked) missing installation.
    expect(json.results[0].error).toBe('No GitHub App installation found')
  })

  it('does not accept a signature computed over the stored ciphertext (generic 401, no sync)', async () => {
    currentSecret = encryptSecretValue(SECRET) as string
    const res = await post(sign(currentSecret))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(findByID).not.toHaveBeenCalled()
  })

  it('accepts legacy plaintext secrets until migrated (no outage window)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    currentSecret = SECRET
    const json = await (await post(sign(SECRET))).json()
    expect(json.results[0].error).toBe('No GitHub App installation found')
    warn.mockRestore()
  })

  it('an undecryptable envelope fails verification (401) rather than skipping it', async () => {
    const good = encryptSecretValue(SECRET) as string
    currentSecret = good.slice(0, -2) + (good.endsWith('00') ? 'ff' : '00')
    const res = await post(sign(SECRET))
    expect(res.status).toBe(401)
    expect(findByID).not.toHaveBeenCalled()
  })
})
