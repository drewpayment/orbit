/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

const find = vi.fn()
const findByID = vi.fn()
vi.mock('payload', () => ({ getPayload: async () => ({ find, findByID }) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/auth/internal-api-auth', () => ({ validateInternalApiKey: () => null }))

import { NextRequest } from 'next/server'
import { encryptSecretJson } from '@/lib/encryption/secret-fields'
import { GET as list } from './route'
import { GET as getOne } from './[id]/route'

const creds = { 'sasl.username': 'svc', 'sasl.password': 'hunter2' }
const req = (path: string) => new NextRequest(`http://localhost/api/internal/kafka-clusters${path}`)

describe('internal kafka-clusters routes hand the Go worker decrypted credentials', () => {
  beforeEach(() => {
    find.mockReset()
    findByID.mockReset()
  })

  it('GET /[id] returns credentials as the original object', async () => {
    findByID.mockResolvedValue({ id: 'c1', name: 'prod', credentials: encryptSecretJson(creds) })
    const res = await getOne(req('/c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).credentials).toEqual(creds)
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: true }))
  })

  it('GET / returns every doc with credentials decrypted', async () => {
    find.mockResolvedValue({
      docs: [
        { id: 'c1', credentials: encryptSecretJson(creds) },
        { id: 'c2', credentials: {} },
      ],
      totalDocs: 2,
    })
    const res = await list(req(''))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.docs[0].credentials).toEqual(creds)
    expect(body.docs[1].credentials).toEqual({})
  })

  it('passes through not-yet-migrated legacy plaintext credentials (no outage window)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    findByID.mockResolvedValue({ id: 'c1', credentials: creds })
    const res = await getOne(req('/c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).credentials).toEqual(creds)
    warn.mockRestore()
  })

  it('fails closed (500, no credential echo) when ciphertext cannot be decrypted', async () => {
    const w = encryptSecretJson(creds) as { enc: string }
    const bad = { enc: w.enc.slice(0, -2) + (w.enc.endsWith('00') ? 'ff' : '00') }
    findByID.mockResolvedValue({ id: 'c1', credentials: bad })
    const res = await getOne(req('/c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain(bad.enc)
  })
})
