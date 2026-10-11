/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

const findByID = vi.fn()
vi.mock('payload', () => ({ getPayload: async () => ({ findByID }) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/auth/internal-api-auth', () => ({ validateInternalApiKey: () => null }))

import { NextRequest } from 'next/server'
import { encrypt } from '@/lib/encryption'
import { encryptSecretValue } from '@/lib/encryption/secret-fields'
import { GET } from './route'

const call = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/internal/llm-providers/p1${qs}`), {
    params: Promise.resolve({ id: 'p1' }),
  })

const baseDoc = {
  id: 'p1',
  workspace: 'ws1',
  provider: 'anthropic',
  baseUrl: '',
  model: 'claude-x',
  isDefault: true,
}

describe('GET /api/internal/llm-providers/[id]', () => {
  beforeEach(() => findByID.mockReset())

  it('reads with overrideAccess and returns the decrypted apiKey', async () => {
    findByID.mockResolvedValue({ ...baseDoc, apiKey: encrypt('sk-ant-real') })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).apiKey).toBe('sk-ant-real')
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'llm-providers', overrideAccess: true }),
    )
  })

  it('returns an empty apiKey for self-hosted providers with no key', async () => {
    findByID.mockResolvedValue({ ...baseDoc, apiKey: '' })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).apiKey).toBe('')
  })

  it('uses a not-yet-migrated legacy plaintext key (no deploy -> migrate outage)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    findByID.mockResolvedValue({ ...baseDoc, apiKey: 'sk-ant-legacy' })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).apiKey).toBe('sk-ant-legacy')
    warn.mockRestore()
  })

  it('fails closed (no fallback to the raw value) when ciphertext is corrupt', async () => {
    const good = encrypt('sk-ant-real')
    const corrupt = good.slice(0, -2) + (good.endsWith('00') ? 'ff' : '00')
    findByID.mockResolvedValue({ ...baseDoc, apiKey: corrupt })
    const res = await call()
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('sk-ant-real')
    expect(text).not.toContain(corrupt)
    expect(text).toMatch(/DECRYPT_FAILED/)
  })

  it('still enforces the workspace filter', async () => {
    findByID.mockResolvedValue({ ...baseDoc, apiKey: encrypt('k') })
    const res = await call('?workspace_id=other')
    expect(res.status).toBe(403)
  })
})
