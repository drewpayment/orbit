import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

import { encryptSecretJson, isEncryptedJson } from '@/lib/encryption/secret-fields'
import { revealClusterCredentials } from './cluster-credentials'

const creds = { 'sasl.username': 'u', 'sasl.password': 'p' }

describe('revealClusterCredentials', () => {
  it('returns the cluster with credentials decrypted to the original object', () => {
    const stored = { id: 'c1', name: 'prod', credentials: encryptSecretJson(creds) }
    const out = revealClusterCredentials(stored)
    expect(out.credentials).toEqual(creds)
    expect(out.name).toBe('prod')
    // does not mutate its input
    expect(isEncryptedJson(stored.credentials)).toBe(true)
  })

  it('leaves clusters without credentials alone', () => {
    expect(revealClusterCredentials({ id: 'c1' })).toEqual({ id: 'c1' })
    expect(revealClusterCredentials({ id: 'c1', credentials: null })).toEqual({ id: 'c1', credentials: null })
  })

  it('treats an empty credentials object (no credentials registered) as empty, not legacy plaintext', () => {
    expect(revealClusterCredentials({ id: 'c1', credentials: {} })).toEqual({ id: 'c1', credentials: {} })
  })

  it('tolerates legacy plaintext objects until migrated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(revealClusterCredentials({ id: 'c1', credentials: creds }).credentials).toEqual(creds)
    warn.mockRestore()
  })

  it('fails closed on corrupt ciphertext', () => {
    const w = encryptSecretJson(creds) as { enc: string }
    expect(() =>
      revealClusterCredentials({ id: 'c1', credentials: { enc: w.enc.slice(0, -2) + (w.enc.endsWith('00') ? 'ff' : '00') } }),
    ).toThrow()
  })
})

import { splitClusterConfig, isSecretConfigKey } from './cluster-credentials'

describe('splitClusterConfig', () => {
  it('moves secret-looking keys out of the plaintext connection config', () => {
    const { plain, secret } = splitClusterConfig({
      'security.protocol': 'SASL_SSL',
      'sasl.password': 'p',
      'sasl.jaas.config': 'x',
      'ssl.key.password': 'k',
      'ssl.truststore.password': 't',
      'api.secret': 's',
      'client.id': 'orbit',
    })
    expect(plain).toEqual({ 'security.protocol': 'SASL_SSL', 'client.id': 'orbit' })
    expect(Object.keys(secret).sort()).toEqual(
      ['api.secret', 'sasl.jaas.config', 'sasl.password', 'ssl.key.password', 'ssl.truststore.password'],
    )
  })

  it('does not flag ordinary keys', () => {
    for (const k of ['bootstrap.servers', 'environment', 'schema.registry.url', 'sasl.mechanism', 'sasl.username']) {
      expect(isSecretConfigKey(k)).toBe(false)
    }
  })

  it('handles undefined', () => {
    expect(splitClusterConfig(undefined)).toEqual({ plain: {}, secret: {} })
  })
})
