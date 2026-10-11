import { describe, it, expect, vi } from 'vitest'

// The encryption module reads ENCRYPTION_KEY at import time.
vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

import { encrypt } from './index'
import {
  isEncryptedEnvelope,
  isEncryptedJson,
  encryptSecretValue,
  encryptSecretJson,
  decryptSecretString,
  decryptSecretJson,
  readSecretString,
  readSecretJson,
  tryReadSecretString,
  secretFieldAccess,
  secretFieldHooks,
  secretJsonFieldHooks,
  secretFieldHooksPreEncrypted,
} from './secret-fields'

describe('isEncryptedEnvelope / isEncryptedJson', () => {
  it('accepts real ciphertext and rejects plaintext, even with colons', () => {
    expect(isEncryptedEnvelope(encrypt('hello'))).toBe(true)
    expect(isEncryptedEnvelope('sk-ant-123')).toBe(false)
    expect(isEncryptedEnvelope('user:pass:word')).toBe(false)
    expect(isEncryptedEnvelope({ a: 1 })).toBe(false)
    expect(isEncryptedEnvelope(null)).toBe(false)
  })

  it('recognises only the exact { enc } wrapper', () => {
    expect(isEncryptedJson({ enc: encrypt('{}') })).toBe(true)
    expect(isEncryptedJson({ enc: 'nope' })).toBe(false)
    expect(isEncryptedJson({ enc: encrypt('x'), extra: 1 })).toBe(false)
    expect(isEncryptedJson({ apiToken: 'x' })).toBe(false)
    expect(isEncryptedJson(encrypt('x'))).toBe(false)
  })
})

describe('encryptSecretValue (text)', () => {
  it('encrypts plaintext strings, including ones that contain colons', () => {
    const out = encryptSecretValue('sk-ant-123') as string
    expect(out).not.toContain('sk-ant-123')
    expect(decryptSecretString(out)).toBe('sk-ant-123')
    expect(decryptSecretString(encryptSecretValue('a:b:c'))).toBe('a:b:c')
  })

  it('keeps an envelope only when it equals the already-stored value (idempotent re-save)', () => {
    const stored = encryptSecretValue('secret') as string
    expect(encryptSecretValue(stored, stored)).toBe(stored)
  })

  it('re-encrypts a caller-supplied envelope that is not the stored value (no decryption oracle)', () => {
    const victim = encrypt('victim-secret')
    const planted = encryptSecretValue(victim, undefined) as string
    expect(planted).not.toBe(victim)
    // one layer of decryption yields ciphertext, never the victim's plaintext
    expect(decryptSecretString(planted)).toBe(victim)
    const other = encryptSecretValue(victim, encrypt('different-stored')) as string
    expect(decryptSecretString(other)).toBe(victim)
  })

  it('trustEnvelope (pre-encrypting server writers) keeps envelopes', () => {
    const e = encrypt('t')
    expect(encryptSecretValue(e, undefined, { trustEnvelope: true })).toBe(e)
  })

  it('leaves empty values untouched', () => {
    expect(encryptSecretValue(undefined)).toBeUndefined()
    expect(encryptSecretValue(null)).toBeNull()
    expect(encryptSecretValue('')).toBe('')
    expect(encryptSecretValue({})).toEqual({})
  })
})

describe('encryptSecretJson', () => {
  it('stores objects as an { enc } wrapper that round-trips', () => {
    const out = encryptSecretJson({ apiToken: 'dop_v1_x' }) as { enc: string }
    expect(Object.keys(out)).toEqual(['enc'])
    expect(JSON.stringify(out)).not.toContain('dop_v1_x')
    expect(decryptSecretJson(out)).toEqual({ apiToken: 'dop_v1_x' })
  })

  it('keeps a wrapper only when it equals the stored one', () => {
    const stored = encryptSecretJson({ a: 1 }) as { enc: string }
    expect(encryptSecretJson({ enc: stored.enc }, stored)).toEqual(stored)
  })

  it('re-encrypts a planted wrapper from another record', () => {
    const victim = encryptSecretJson({ apiToken: 'victim' }) as { enc: string }
    const planted = encryptSecretJson({ enc: victim.enc }, undefined) as { enc: string }
    expect(planted.enc).not.toBe(victim.enc)
    expect(decryptSecretJson(planted)).toEqual({ enc: victim.enc })
  })

  it('leaves empty values untouched', () => {
    expect(encryptSecretJson(undefined)).toBeUndefined()
    expect(encryptSecretJson({})).toEqual({})
  })
})

describe('strict decrypt helpers fail closed', () => {
  it('throw on plaintext and tampered ciphertext', () => {
    expect(() => decryptSecretString('sk-plaintext')).toThrow(/not encrypted/)
    expect(() => decryptSecretJson({ a: 1 })).toThrow(/not encrypted/)
    const good = encryptSecretValue('secret') as string
    expect(() => decryptSecretString(good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'))).toThrow()
    expect(() => decryptSecretString(undefined)).toThrow()
  })
})

describe('rollout-tolerant readers', () => {
  it('readSecretString decrypts envelopes, passes legacy plaintext, nulls empties', () => {
    expect(readSecretString(encryptSecretValue('k'))).toBe('k')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readSecretString('legacy-plain', 'x.y')).toBe('legacy-plain')
    expect(readSecretString('legacy-plain', 'x.y')).toBe('legacy-plain')
    expect(warn).toHaveBeenCalledTimes(1) // once per label
    warn.mockRestore()
    expect(readSecretString('')).toBeNull()
    expect(readSecretString(undefined)).toBeNull()
  })

  it('readSecretString throws (never falls back) when an envelope fails to decrypt', () => {
    const good = encrypt('k')
    const bad = good.slice(0, -2) + (good.endsWith('00') ? 'ff' : '00')
    expect(isEncryptedEnvelope(bad)).toBe(true)
    expect(() => readSecretString(bad)).toThrow()
    expect(tryReadSecretString(bad)).toBeNull()
  })

  it('readSecretJson decrypts wrappers, passes legacy objects, throws on bad ciphertext', () => {
    expect(readSecretJson(encryptSecretJson({ a: 1 }))).toEqual({ a: 1 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readSecretJson({ apiToken: 'plain' }, 'c.d')).toEqual({ apiToken: 'plain' })
    warn.mockRestore()
    expect(readSecretJson({})).toBeNull()
    const w = encryptSecretJson({ a: 1 }) as { enc: string }
    const bad = { enc: w.enc.slice(0, -2) + (w.enc.endsWith('00') ? 'ff' : '00') }
    expect(() => readSecretJson(bad)).toThrow()
  })

  it('tryReadSecretString returns plaintext for valid ciphertext and legacy values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(tryReadSecretString(encryptSecretValue('whsec_1'))).toBe('whsec_1')
    expect(tryReadSecretString('whsec_legacy')).toBe('whsec_legacy')
    warn.mockRestore()
    expect(tryReadSecretString(undefined)).toBeNull()
  })
})

describe('field config helpers', () => {
  it('secretFieldAccess denies API reads', async () => {
    expect(await secretFieldAccess.read!({} as never)).toBe(false)
  })

  it('hooks encrypt and pass previousValue through', async () => {
    const [text] = secretFieldHooks.beforeChange
    const [json] = secretJsonFieldHooks.beforeChange
    const [pre] = secretFieldHooksPreEncrypted.beforeChange
    expect(isEncryptedEnvelope(await text({ value: 'plain' } as never))).toBe(true)
    expect(isEncryptedJson(await json({ value: { a: 1 } } as never))).toBe(true)
    const stored = encrypt('x')
    expect(await text({ value: stored, previousValue: stored } as never)).toBe(stored)
    expect(await text({ value: stored, previousValue: 'other' } as never)).not.toBe(stored)
    expect(await pre({ value: stored } as never)).toBe(stored)
  })
})
