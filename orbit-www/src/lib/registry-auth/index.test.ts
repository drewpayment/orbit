/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock environment variable
const MOCK_SECRET = 'test-secret-key-for-jwt-signing-min-32-chars'

vi.stubEnv('ORBIT_REGISTRY_JWT_SECRET', MOCK_SECRET)

// Import after mocking env
const { generatePullToken, validatePullToken, generateDockerToken } = await import('./index')

describe('registry-auth', () => {
  describe('generatePullToken', () => {
    it('generates a valid JWT with correct claims', async () => {
      const token = await generatePullToken({
        workspaceSlug: 'my-workspace',
        appSlug: 'my-app',
      })

      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT format
    })
  })

  describe('validatePullToken', () => {
    it('validates a token and returns claims', async () => {
      const token = await generatePullToken({
        workspaceSlug: 'my-workspace',
        appSlug: 'my-app',
      })

      const claims = await validatePullToken(token)

      expect(claims.scope).toBe('repository:my-workspace/my-app:pull')
      expect(claims.sub).toBe('orbit-deployment')
      expect(claims.iss).toBe('orbit')
    })

    it('rejects expired tokens', async () => {
      // Create a token that's already expired
      const token = await generatePullToken({
        workspaceSlug: 'test',
        appSlug: 'test',
        expiresInSeconds: -1, // Already expired
      })

      await expect(validatePullToken(token)).rejects.toThrow()
    })

    it('rejects invalid tokens', async () => {
      await expect(validatePullToken('invalid.token.here')).rejects.toThrow()
    })
  })

  describe('generateDockerToken', () => {
    it('generates Docker-format token response', async () => {
      const result = await generateDockerToken({
        scope: 'repository:my-workspace/my-app:pull',
      })

      expect(result.token).toBeTruthy()
      expect(result.expires_in).toBe(3600)
      expect(result.issued_at).toBeTruthy()
    })
  })
})
