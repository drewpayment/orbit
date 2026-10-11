import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

import { encryptSecretJson } from '@/lib/encryption/secret-fields'
import { revealCloudCredentials, publicCloudAccount } from './credentials'

const azure = { tenantId: 't-1', clientId: 'c-1', clientSecret: 'super-secret' }

describe('revealCloudCredentials', () => {
  it('decrypts stored credentials to the original object', () => {
    expect(revealCloudCredentials(encryptSecretJson(azure))).toEqual(azure)
  })

  it('tolerates legacy plaintext objects until migrated, fails closed on corrupt ciphertext', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(revealCloudCredentials(azure)).toEqual(azure)
    warn.mockRestore()
    const w = encryptSecretJson(azure) as { enc: string }
    expect(() => revealCloudCredentials({ enc: w.enc.slice(0, -2) + (w.enc.endsWith('00') ? 'ff' : '00') })).toThrow()
  })

  it('returns null when nothing is stored', () => {
    expect(revealCloudCredentials(undefined)).toBeNull()
    expect(revealCloudCredentials(null)).toBeNull()
  })
})

describe('publicCloudAccount', () => {
  it('keeps non-secret identifiers and never returns secrets or ciphertext', () => {
    const doc = { id: 'a1', name: 'prod', provider: 'azure', credentials: encryptSecretJson(azure) }
    const out = publicCloudAccount(doc)
    expect(out.credentials).toEqual({ tenantId: 't-1', clientId: 'c-1' })
    expect(JSON.stringify(out)).not.toContain('super-secret')
    expect(out.name).toBe('prod')
  })

  it('digitalocean exposes no credential fields at all', () => {
    const doc = { id: 'a2', provider: 'digitalocean', credentials: encryptSecretJson({ apiToken: 'dop_v1_x' }) }
    expect(publicCloudAccount(doc).credentials).toEqual({})
  })

  it('returns empty credentials (no throw, no leak) when stored ciphertext is unreadable', () => {
    const w = encryptSecretJson(azure) as { enc: string }
    const bad = { enc: w.enc.slice(0, -2) + (w.enc.endsWith('00') ? 'ff' : '00') }
    const out = publicCloudAccount({ id: 'a3', provider: 'azure', credentials: bad })
    expect(out.credentials).toEqual({})
    expect(JSON.stringify(out)).not.toContain(bad.enc)
  })
})

import { mergeCredentialUpdate } from './credentials'

describe('mergeCredentialUpdate', () => {
  it('keeps the stored secret when the form sends a blank one', () => {
    expect(
      mergeCredentialUpdate(azure, { tenantId: 't-2', clientId: 'c-1', clientSecret: '' }),
    ).toEqual({ tenantId: 't-2', clientId: 'c-1', clientSecret: 'super-secret' })
  })

  it('replaces the secret only when a new one is entered', () => {
    expect(mergeCredentialUpdate(azure, { clientSecret: 'rotated' }).clientSecret).toBe('rotated')
  })

  it('works when nothing is stored yet', () => {
    expect(mergeCredentialUpdate(null, { apiToken: 'x', extra: '' })).toEqual({ apiToken: 'x' })
  })
})
