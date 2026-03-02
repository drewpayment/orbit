import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

describe('getBifrostConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns config from database when exists', async () => {
    const { getPayload } = await import('payload')
    const mockPayload = {
      find: vi.fn().mockResolvedValue({
        docs: [{
          id: '1',
          advertisedHost: 'kafka.example.com:9092',
          defaultAuthMethod: 'SASL/SCRAM-SHA-256',
          connectionMode: 'bifrost',
          tlsEnabled: true,
        }],
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const { getBifrostConfig } = await import('./bifrost-config')
    const config = await getBifrostConfig()

    expect(config.advertisedHost).toBe('kafka.example.com:9092')
    expect(config.defaultAuthMethod).toBe('SASL/SCRAM-SHA-256')
    expect(config.connectionMode).toBe('bifrost')
    expect(config.tlsEnabled).toBe(true)
  })

  it('returns defaults when no config exists', async () => {
    const { getPayload } = await import('payload')
    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const { getBifrostConfig } = await import('./bifrost-config')
    const config = await getBifrostConfig()

    expect(config.advertisedHost).toBe('traefik.orbit.orb.local:9092')
    expect(config.defaultAuthMethod).toBe('SASL/SCRAM-SHA-256')
    expect(config.connectionMode).toBe('bifrost')
    expect(config.routingMode).toBe('sasl')
    expect(config.tlsEnabled).toBe(false)
  })

  it('uses default values for missing fields in database config', async () => {
    const { getPayload } = await import('payload')
    const mockPayload = {
      find: vi.fn().mockResolvedValue({
        docs: [{
          id: '1',
          advertisedHost: 'custom-host:9092',
          // Missing other fields
        }],
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const { getBifrostConfig } = await import('./bifrost-config')
    const config = await getBifrostConfig()

    expect(config.advertisedHost).toBe('custom-host:9092')
    // Should use defaults for missing fields
    expect(config.defaultAuthMethod).toBe('SASL/SCRAM-SHA-256')
    expect(config.connectionMode).toBe('bifrost')
    expect(config.routingMode).toBe('sasl')
    expect(config.tlsEnabled).toBe(false)
  })

  it('handles tlsEnabled being explicitly false', async () => {
    const { getPayload } = await import('payload')
    const mockPayload = {
      find: vi.fn().mockResolvedValue({
        docs: [{
          id: '1',
          advertisedHost: 'kafka.example.com:9092',
          defaultAuthMethod: 'SASL/SCRAM-SHA-512',
          connectionMode: 'direct',
          tlsEnabled: false,
        }],
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const { getBifrostConfig } = await import('./bifrost-config')
    const config = await getBifrostConfig()

    expect(config.tlsEnabled).toBe(false)
    expect(config.connectionMode).toBe('direct')
    expect(config.defaultAuthMethod).toBe('SASL/SCRAM-SHA-512')
  })
})
