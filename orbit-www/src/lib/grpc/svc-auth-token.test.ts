/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as jose from 'jose'

const MOCK_SECRET = 'svc-auth-test-secret-at-least-32-bytes-long!!'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function importFresh() {
  vi.resetModules()
  return import('./svc-auth-token')
}

describe('mintServiceToken', () => {
  it('produces a token whose claims match the Go svcauth verifier shape', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', MOCK_SECRET)
    const { mintServiceToken } = await importFresh()

    const token = await mintServiceToken('user-abc', 'workspace-xyz')
    expect(token.split('.')).toHaveLength(3)

    const secret = new TextEncoder().encode(MOCK_SECRET)
    const { payload, protectedHeader } = await jose.jwtVerify(token, secret, {
      issuer: 'orbit-www',
      audience: 'orbit-services',
    })

    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.sub).toBe('user-abc')
    expect(payload.wid).toBe('workspace-xyz')
    expect(payload.iss).toBe('orbit-www')
    expect(payload.aud).toBe('orbit-services')
    expect(payload.jti).toBeTruthy()
    // 120s TTL.
    expect((payload.exp as number) - (payload.iat as number)).toBe(120)
  })

  it('sets the adm claim only when platformAdmin is true', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', MOCK_SECRET)
    const { mintServiceToken } = await importFresh()
    const secret = new TextEncoder().encode(MOCK_SECRET)

    const adminToken = await mintServiceToken('user-abc', 'ws', { platformAdmin: true })
    const { payload: adminPayload } = await jose.jwtVerify(adminToken, secret)
    expect(adminPayload.adm).toBe(true)
  })

  it('omits the adm claim when platformAdmin is false or unset (fail closed)', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', MOCK_SECRET)
    const { mintServiceToken } = await importFresh()
    const secret = new TextEncoder().encode(MOCK_SECRET)

    const falseToken = await mintServiceToken('user-abc', 'ws', { platformAdmin: false })
    const { payload: falsePayload } = await jose.jwtVerify(falseToken, secret)
    expect(falsePayload.adm).toBeUndefined()

    const defaultToken = await mintServiceToken('user-abc', 'ws')
    const { payload: defaultPayload } = await jose.jwtVerify(defaultToken, secret)
    expect(defaultPayload.adm).toBeUndefined()
  })

  it('allows an empty workspace for RPCs with no workspace scope', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', MOCK_SECRET)
    const { mintServiceToken } = await importFresh()

    const token = await mintServiceToken('user-abc', '')
    const secret = new TextEncoder().encode(MOCK_SECRET)
    const { payload } = await jose.jwtVerify(token, secret)
    expect(payload.wid).toBe('')
  })

  it('throws when ORBIT_SVC_AUTH_SECRET is unset', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', '')
    const { mintServiceToken } = await importFresh()
    await expect(mintServiceToken('user-abc', 'ws')).rejects.toThrow(/ORBIT_SVC_AUTH_SECRET/)
  })

  it('throws when the secret is shorter than 32 bytes', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', 'too-short')
    const { mintServiceToken } = await importFresh()
    await expect(mintServiceToken('user-abc', 'ws')).rejects.toThrow(/at least 32 bytes/)
  })

  it('throws when subject is missing', async () => {
    vi.stubEnv('ORBIT_SVC_AUTH_SECRET', MOCK_SECRET)
    const { mintServiceToken } = await importFresh()
    await expect(mintServiceToken('', 'ws')).rejects.toThrow(/subject/)
  })
})
