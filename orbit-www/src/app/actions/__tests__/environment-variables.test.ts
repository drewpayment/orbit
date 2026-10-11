import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn(), check: vi.fn() }))
vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
}))

import { getPayload } from 'payload'
import * as envActions from '../environment-variables'
import { resolveEnvironmentVariablesUnchecked } from '@/lib/environment-variables/resolve'

describe('decrypted variable resolution is not a client-callable server action', () => {
  it('the use-server module does not export any resolver of plaintext variables', () => {
    // Every export of a 'use server' module is a public endpoint. Plaintext
    // resolution must stay in lib/environment-variables/resolve (server-only).
    expect(Object.keys(envActions).filter((k) => /resolve/i.test(k))).toEqual([])
  })
})

describe('resolveEnvironmentVariablesUnchecked (server-internal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges workspace variables with app overrides and decrypts them', async () => {
    const find = vi
      .fn()
      .mockResolvedValueOnce({ docs: [{ name: 'API_KEY', value: 'enc:ws' }, { name: 'A', value: 'enc:1' }] })
      .mockResolvedValueOnce({ docs: [{ name: 'API_KEY', value: 'enc:app' }] })
    ;(getPayload as any).mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({ id: 'app-1', workspace: 'ws-1' }),
      find,
    })

    const r = await resolveEnvironmentVariablesUnchecked('app-1', 'build')

    expect(r).toEqual({ success: true, variables: { API_KEY: 'app', A: '1' } })
  })
})
