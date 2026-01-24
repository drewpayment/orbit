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

// Import types and mapping functions after mocks are set up
import {
  // Type exports - these are compile-time checks
  type VirtualClusterConfig,
  type CredentialConfig,
  type PermissionTemplateType,
  type CustomPermission,
  type GatewayStatus,
  type FullConfig,
  type PolicyConfig,
  // Mapping function exports
  mapProtoToVirtualCluster,
  mapProtoToCredential,
  mapPermissionTemplate,
  mapPermissionTemplateToProto,
  mapProtoToPolicy,
  // Auth helper (tested in integration context)
  requireAdmin,
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

    it('should export mapping functions', () => {
      expect(typeof mapProtoToVirtualCluster).toBe('function')
      expect(typeof mapProtoToCredential).toBe('function')
      expect(typeof mapPermissionTemplate).toBe('function')
      expect(typeof mapPermissionTemplateToProto).toBe('function')
      expect(typeof mapProtoToPolicy).toBe('function')
    })

    it('should export requireAdmin function', () => {
      expect(typeof requireAdmin).toBe('function')
    })
  })

  describe('mapProtoToVirtualCluster', () => {
    it('should map proto VirtualClusterConfig to our interface', () => {
      // Use type assertion since we're creating a mock proto object
      const proto = {
        id: 'vc-123',
        applicationId: 'app-456',
        applicationSlug: 'orders-service',
        workspaceSlug: 'acme-corp',
        environment: 'production',
        topicPrefix: 'acme-corp.orders-service.production.',
        groupPrefix: 'acme-corp.orders-service.production.',
        transactionIdPrefix: 'acme-corp.orders-service.production.',
        advertisedHost: 'kafka-gateway.example.com',
        advertisedPort: 9092,
        physicalBootstrapServers: 'broker1:9092,broker2:9092',
        readOnly: false,
      } as unknown as ProtoVirtualClusterConfig

      const result = mapProtoToVirtualCluster(proto)

      expect(result).toEqual({
        id: 'vc-123',
        applicationId: 'app-456',
        applicationSlug: 'orders-service',
        workspaceSlug: 'acme-corp',
        environment: 'production',
        topicPrefix: 'acme-corp.orders-service.production.',
        groupPrefix: 'acme-corp.orders-service.production.',
        transactionIdPrefix: 'acme-corp.orders-service.production.',
        advertisedHost: 'kafka-gateway.example.com',
        advertisedPort: 9092,
        physicalBootstrapServers: 'broker1:9092,broker2:9092',
        readOnly: false,
      })
    })

    it('should handle readOnly=true', () => {
      const proto = {
        id: 'vc-readonly',
        applicationId: 'app-1',
        applicationSlug: 'app',
        workspaceSlug: 'ws',
        environment: 'staging',
        topicPrefix: 'prefix.',
        groupPrefix: 'prefix.',
        transactionIdPrefix: 'prefix.',
        advertisedHost: 'host',
        advertisedPort: 9092,
        physicalBootstrapServers: 'kafka:9092',
        readOnly: true,
      } as unknown as ProtoVirtualClusterConfig

      const result = mapProtoToVirtualCluster(proto)
      expect(result.readOnly).toBe(true)
    })
  })

  describe('mapProtoToCredential', () => {
    it('should map proto CredentialConfig to our interface with producer template', () => {
      const proto = {
        id: 'cred-123',
        virtualClusterId: 'vc-456',
        username: 'orders-producer',
        passwordHash: 'argon2:$hashvalue',
        template: PermissionTemplate.PRODUCER,
        customPermissions: [],
      } as unknown as ProtoCredentialConfig

      const result = mapProtoToCredential(proto)

      expect(result).toEqual({
        id: 'cred-123',
        virtualClusterId: 'vc-456',
        username: 'orders-producer',
        passwordHash: 'argon2:$hashvalue',
        template: 'producer',
        customPermissions: [],
      })
    })

    it('should map proto CredentialConfig with custom permissions', () => {
      const proto = {
        id: 'cred-custom',
        virtualClusterId: 'vc-789',
        username: 'custom-user',
        passwordHash: 'hash',
        template: PermissionTemplate.CUSTOM,
        customPermissions: [
          {
            resourceType: 'topic',
            resourcePattern: 'orders.*',
            operations: ['read', 'write'],
          },
          {
            resourceType: 'group',
            resourcePattern: 'order-consumers',
            operations: ['read'],
          },
        ],
      } as unknown as ProtoCredentialConfig

      const result = mapProtoToCredential(proto)

      expect(result.template).toBe('custom')
      expect(result.customPermissions).toHaveLength(2)
      expect(result.customPermissions[0]).toEqual({
        resourceType: 'topic',
        resourcePattern: 'orders.*',
        operations: ['read', 'write'],
      })
    })

    it('should map all permission template types', () => {
      const templates = [
        { proto: PermissionTemplate.PRODUCER, expected: 'producer' },
        { proto: PermissionTemplate.CONSUMER, expected: 'consumer' },
        { proto: PermissionTemplate.ADMIN, expected: 'admin' },
        { proto: PermissionTemplate.CUSTOM, expected: 'custom' },
      ]

      for (const { proto, expected } of templates) {
        const result = mapProtoToCredential({
          id: 'cred',
          virtualClusterId: 'vc',
          username: 'user',
          passwordHash: 'hash',
          template: proto,
          customPermissions: [],
        } as unknown as ProtoCredentialConfig)
        expect(result.template).toBe(expected)
      }
    })
  })

  describe('mapPermissionTemplate', () => {
    it('should map proto enum to string type', () => {
      expect(mapPermissionTemplate(PermissionTemplate.PRODUCER)).toBe('producer')
      expect(mapPermissionTemplate(PermissionTemplate.CONSUMER)).toBe('consumer')
      expect(mapPermissionTemplate(PermissionTemplate.ADMIN)).toBe('admin')
      expect(mapPermissionTemplate(PermissionTemplate.CUSTOM)).toBe('custom')
    })

    it('should default to custom for unspecified', () => {
      expect(mapPermissionTemplate(PermissionTemplate.UNSPECIFIED)).toBe('custom')
    })

    it('should default to custom for unknown values', () => {
      expect(mapPermissionTemplate(999 as PermissionTemplate)).toBe('custom')
    })
  })

  describe('mapPermissionTemplateToProto', () => {
    it('should map string type to proto enum', () => {
      expect(mapPermissionTemplateToProto('producer')).toBe(PermissionTemplate.PRODUCER)
      expect(mapPermissionTemplateToProto('consumer')).toBe(PermissionTemplate.CONSUMER)
      expect(mapPermissionTemplateToProto('admin')).toBe(PermissionTemplate.ADMIN)
      expect(mapPermissionTemplateToProto('custom')).toBe(PermissionTemplate.CUSTOM)
    })
  })

  describe('mapProtoToPolicy', () => {
    it('should map proto PolicyConfig to our interface', () => {
      const proto = {
        id: 'policy-1',
        environment: 'production',
        maxPartitions: 32,
        minPartitions: 1,
        maxRetentionMs: 604800000n, // 7 days in ms
        minReplicationFactor: 3,
        allowedCleanupPolicies: ['delete', 'compact'],
        namingPattern: '^[a-z][a-z0-9-]*$',
        maxNameLength: 255,
      }

      const result = mapProtoToPolicy(proto)

      expect(result).toEqual({
        id: 'policy-1',
        environment: 'production',
        maxPartitions: 32,
        minPartitions: 1,
        maxRetentionMs: 604800000n,
        minReplicationFactor: 3,
        allowedCleanupPolicies: ['delete', 'compact'],
        namingPattern: '^[a-z][a-z0-9-]*$',
        maxNameLength: 255,
      })
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
})
