import { describe, it, expect } from 'vitest'

// Set up test encryption key BEFORE importing the module
// (module loads env var on import, so it must be set first)
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = Buffer.from('test-encryption-key-32-bytes!').toString('base64')
}

import { encrypt, decrypt } from './index'

describe('Encryption', () => {
  it('encrypts and decrypts text correctly', () => {
    const plaintext = 'ghp_test_token_abc123'
    const encrypted = encrypt(plaintext)
    const decrypted = decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toContain(':') // Contains IV and auth tag
  })

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'test_token'
    const encrypted1 = encrypt(plaintext)
    const encrypted2 = encrypt(plaintext)

    expect(encrypted1).not.toBe(encrypted2)
    expect(decrypt(encrypted1)).toBe(plaintext)
    expect(decrypt(encrypted2)).toBe(plaintext)
  })

  it('throws error for invalid encrypted text', () => {
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted text format')
  })

  it('throws error for tampered ciphertext', () => {
    const encrypted = encrypt('test')
    const tampered = encrypted.replace(/.$/, 'X') // Change last char

    expect(() => decrypt(tampered)).toThrow()
  })

  it('handles long strings', () => {
    const plaintext = 'a'.repeat(1000)
    const encrypted = encrypt(plaintext)
    const decrypted = decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
  })

  it('handles special characters', () => {
    const plaintext = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
    const encrypted = encrypt(plaintext)
    const decrypted = decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
  })

  it('handles unicode characters', () => {
    const plaintext = 'Hello 世界 🌍'
    const encrypted = encrypt(plaintext)
    const decrypted = decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
  })
})
