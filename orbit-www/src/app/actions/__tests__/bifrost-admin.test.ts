import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module under test
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/grpc/bifrost-client', () => ({
  bifrostClient: {
    listVirtualClusters: vi.fn(),
    upsertVirtualCluster: vi.fn(),
    deleteVirtualCluster: vi.fn(),
    setVirtualClusterReadOnly: vi.fn(),
    listCredentials: vi.fn(),
    upsertCredential: vi.fn(),
    revokeCredential: vi.fn(),
    getStatus: vi.fn(),
    getFullConfig: vi.fn(),
    listPolicies: vi.fn(),
    upsertPolicy: vi.fn(),
    deletePolicy: vi.fn(),
  },
}))

// Import types after mocks are set up
import {
  // Type exports - these are compile-time checks
  type VirtualClusterConfig,
  type CredentialConfig,
  type PermissionTemplateType,
  type CustomPermission,
  type GatewayStatus,
  type FullConfig,
  type PolicyConfig,
} from '../bifrost-admin'

import {
  PermissionTemplate,
  type VirtualClusterConfig as ProtoVirtualClusterConfig,
  type CredentialConfig as ProtoCredentialConfig,
  type PolicyConfig as ProtoPolicyConfig,
} from '@/lib/proto/idp/gateway/v1/gateway_pb'

describe('bifrost-admin module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('module exports', () => {
    it('should export type definitions (compile-time verification)', () => {
      // These type assertions verify the types are exported correctly
      // If types are missing or wrong, TypeScript will fail to compile
      const virtualCluster: VirtualClusterConfig = {
        id: 'vc-1',
        applicationId: 'app-1',
        applicationSlug: 'my-app',
        workspaceSlug: 'my-workspace',
        environment: 'production',
        topicPrefix: 'my-workspace.my-app.production.',
        groupPrefix: 'my-workspace.my-app.production.',
        transactionIdPrefix: 'my-workspace.my-app.production.',
        advertisedHost: 'gateway.example.com',
        advertisedPort: 9092,
        physicalBootstrapServers: 'kafka:9092',
        readOnly: false,
      }
      expect(virtualCluster).toBeDefined()

      const credential: CredentialConfig = {
        id: 'cred-1',
        virtualClusterId: 'vc-1',
        username: 'service-account-1',
        passwordHash: 'hashed',
        template: 'producer',
        customPermissions: [],
      }
      expect(credential).toBeDefined()

      const permission: PermissionTemplateType = 'admin'
      expect(permission).toBe('admin')

      const customPerm: CustomPermission = {
        resourceType: 'topic',
        resourcePattern: 'orders.*',
        operations: ['read', 'write'],
      }
      expect(customPerm).toBeDefined()

      const status: GatewayStatus = {
        status: 'healthy',
        activeConnections: 10,
        virtualClusterCount: 5,
        versionInfo: { version: '1.0.0' },
      }
      expect(status).toBeDefined()

      const policy: PolicyConfig = {
        id: 'policy-1',
        environment: 'production',
        maxPartitions: 32,
        minPartitions: 1,
        maxRetentionMs: 604800000n,
        minReplicationFactor: 3,
        allowedCleanupPolicies: ['delete', 'compact'],
        namingPattern: '^[a-z][a-z0-9-]*$',
        maxNameLength: 255,
      }
      expect(policy).toBeDefined()

      const fullConfig: FullConfig = {
        virtualClusters: [virtualCluster],
        credentials: [credential],
        policies: [policy],
      }
      expect(fullConfig).toBeDefined()
    })

  })

  describe('virtual cluster server actions', () => {
    it('should export listVirtualClusters function', async () => {
      const { listVirtualClusters } = await import('../bifrost-admin')
      expect(typeof listVirtualClusters).toBe('function')
    })

    it('should export createVirtualCluster function', async () => {
      const { createVirtualCluster } = await import('../bifrost-admin')
      expect(typeof createVirtualCluster).toBe('function')
    })

    it('should export deleteVirtualCluster function', async () => {
      const { deleteVirtualCluster } = await import('../bifrost-admin')
      expect(typeof deleteVirtualCluster).toBe('function')
    })

    it('should export setVirtualClusterReadOnly function', async () => {
      const { setVirtualClusterReadOnly } = await import('../bifrost-admin')
      expect(typeof setVirtualClusterReadOnly).toBe('function')
    })
  })

  describe('credential server actions', () => {
    it('should export listCredentials function', async () => {
      const { listCredentials } = await import('../bifrost-admin')
      expect(typeof listCredentials).toBe('function')
    })

    it('should export createCredential function', async () => {
      const { createCredential } = await import('../bifrost-admin')
      expect(typeof createCredential).toBe('function')
    })

    it('should export revokeCredential function', async () => {
      const { revokeCredential } = await import('../bifrost-admin')
      expect(typeof revokeCredential).toBe('function')
    })
  })

  describe('status server actions', () => {
    it('should export getGatewayStatus function', async () => {
      const { getGatewayStatus } = await import('../bifrost-admin')
      expect(typeof getGatewayStatus).toBe('function')
    })

    it('should export getFullConfig function', async () => {
      const { getFullConfig } = await import('../bifrost-admin')
      expect(typeof getFullConfig).toBe('function')
    })
  })
})
