/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('validateInternalApiKey', () => {
  it('returns null when the supplied key matches the env key', async () => {
    vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'super-secret-key-for-testing-only')
    const { validateInternalApiKey } = await import('./internal-api-auth')
    const result = validateInternalApiKey('super-secret-key-for-testing-only')
    expect(result).toBeNull()
  })

  it('returns a 401 response when the key is wrong', async () => {
    vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'correct-key')
    const { validateInternalApiKey } = await import('./internal-api-auth')
    const result = validateInternalApiKey('wrong-key')
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })

  it('returns a 401 response when no key is supplied', async () => {
    vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'correct-key')
    const { validateInternalApiKey } = await import('./internal-api-auth')
    const result = validateInternalApiKey(null)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })

  it('returns a 401 response when ORBIT_INTERNAL_API_KEY is unset (fail-closed)', async () => {
    vi.stubEnv('ORBIT_INTERNAL_API_KEY', '')
    const { validateInternalApiKey } = await import('./internal-api-auth')
    // Even if someone supplies a key, no key should be treated as valid
    // when the env var is not configured
    const result = validateInternalApiKey('anything')
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })

  it('returns a 401 when key lengths differ (prevents trivial bypass)', async () => {
    vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'abc')
    const { validateInternalApiKey } = await import('./internal-api-auth')
    const result = validateInternalApiKey('abcd')
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })
})
