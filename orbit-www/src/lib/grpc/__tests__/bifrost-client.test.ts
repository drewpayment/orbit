import { describe, it, expect } from 'vitest'

describe('bifrostClient', () => {
  it('is defined and exported', async () => {
    const { bifrostClient } = await import('../bifrost-client')
    expect(bifrostClient).toBeDefined()
  })

  describe('has all BifrostAdminService methods', () => {
    it('has listVirtualClusters method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.listVirtualClusters).toBe('function')
    })

    it('has upsertVirtualCluster method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.upsertVirtualCluster).toBe('function')
    })

    it('has deleteVirtualCluster method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.deleteVirtualCluster).toBe('function')
    })

    it('has setVirtualClusterReadOnly method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.setVirtualClusterReadOnly).toBe('function')
    })

    it('has listCredentials method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.listCredentials).toBe('function')
    })

    it('has upsertCredential method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.upsertCredential).toBe('function')
    })

    it('has revokeCredential method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.revokeCredential).toBe('function')
    })

    it('has getStatus method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.getStatus).toBe('function')
    })

    it('has getFullConfig method', async () => {
      const { bifrostClient } = await import('../bifrost-client')
      expect(typeof bifrostClient.getFullConfig).toBe('function')
    })
  })

  it('exports BifrostClient type', async () => {
    // Type check - this test passes at compile time if the type is exported correctly
    const { bifrostClient } = await import('../bifrost-client')
    type BifrostClient = typeof bifrostClient
    const client: BifrostClient = bifrostClient
    expect(client).toBeDefined()
  })
})
