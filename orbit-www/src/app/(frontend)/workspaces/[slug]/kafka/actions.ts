'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getTemporalClient } from '@/lib/temporal/client'

// ============================================================================
// Types
// ============================================================================

export interface KafkaTopic {
  id: string
  workspaceId: string
  name: string
  environment: string
  clusterId?: string
  fullTopicName?: string
  partitions: number
  replicationFactor: number
  retentionMs: number
  cleanupPolicy: string
  compression: string
  config: Record<string, string>
  status: 'pending_approval' | 'provisioning' | 'active' | 'failed' | 'deleting'
  provisioningError?: string
  workflowId?: string
  approvalRequired: boolean
  approvedBy?: string
  approvedAt?: string
  createdAt: string
  updatedAt: string
  description?: string
}

// ============================================================================
// Payload Types
// ============================================================================

interface PayloadKafkaTopic {
  id: string
  workspace: string | { id: string; slug?: string }
  name: string
  environment: string
  cluster?: string | { id: string }
  fullTopicName?: string
  partitions: number
  replicationFactor: number
  retentionMs: number
  cleanupPolicy: string
  compression: string
  config?: Record<string, string>
  status: 'pending-approval' | 'provisioning' | 'active' | 'failed' | 'deleting'
  provisioningError?: string
  workflowId?: string
  approvalRequired: boolean
  approvedBy?: string | { id: string }
  approvedAt?: string
  description?: string
  createdBy?: string | { id: string }
  createdAt: string
  updatedAt: string
}

/**
 * Maps a Payload KafkaTopic document to the KafkaTopic interface.
 */
function mapPayloadTopicToKafkaTopic(doc: PayloadKafkaTopic): KafkaTopic {
  const workspaceId = typeof doc.workspace === 'object' ? doc.workspace.id : doc.workspace
  const clusterId = doc.cluster ? (typeof doc.cluster === 'object' ? doc.cluster.id : doc.cluster) : undefined
  const approvedBy = doc.approvedBy ? (typeof doc.approvedBy === 'object' ? doc.approvedBy.id : doc.approvedBy) : undefined

  // Map status from Payload format (pending-approval) to interface format (pending_approval)
  const statusMap: Record<string, KafkaTopic['status']> = {
    'pending-approval': 'pending_approval',
    'provisioning': 'provisioning',
    'active': 'active',
    'failed': 'failed',
    'deleting': 'deleting',
  }

  return {
    id: doc.id,
    workspaceId,
    name: doc.name,
    environment: doc.environment,
    clusterId,
    fullTopicName: doc.fullTopicName,
    partitions: doc.partitions,
    replicationFactor: doc.replicationFactor,
    retentionMs: doc.retentionMs,
    cleanupPolicy: doc.cleanupPolicy,
    compression: doc.compression,
    config: doc.config || {},
    status: statusMap[doc.status] || 'pending_approval',
    provisioningError: doc.provisioningError,
    workflowId: doc.workflowId,
    approvalRequired: doc.approvalRequired,
    approvedBy,
    approvedAt: doc.approvedAt,
    description: doc.description,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export interface KafkaSchema {
  id: string
  workspaceId: string
  topicId: string
  type: 'key' | 'value'
  subject: string
  format: 'avro' | 'protobuf' | 'json'
  content: string
  version: number
  schemaId: number
  compatibility: 'backward' | 'forward' | 'full' | 'none'
  status: string
  createdAt: string
  updatedAt: string
}

export interface KafkaTopicShare {
  id: string
  topicId: string
  sharedWithType: 'workspace' | 'user'
  sharedWithWorkspaceId?: string
  sharedWithUserId?: string
  permission: 'read' | 'write' | 'read_write'
  status: 'pending_request' | 'approved' | 'rejected' | 'revoked'
  requestedBy: string
  requestedAt: string
  justification: string
  approvedBy?: string
  approvedAt?: string
  expiresAt?: string
}

export interface DiscoverableTopic {
  topic: KafkaTopic
  owningWorkspaceName: string
  visibility: 'private' | 'discoverable' | 'public'
  accessStatus: string
  hasSchema: boolean
}

// ============================================================================
// Topic Management Actions
// ============================================================================

export interface CreateTopicInput {
  workspaceId: string
  name: string
  environment: string
  partitions?: number
  replicationFactor?: number
  retentionMs?: number
  cleanupPolicy?: string
  compression?: string
  config?: Record<string, string>
  description?: string
}

export interface CreateTopicResult {
  success: boolean
  topic?: KafkaTopic
  workflowId?: string
  error?: string
}

/**
 * Create a new Kafka topic.
 *
 * Flow:
 * 1. Validate user is workspace member
 * 2. Get workspace slug for topic naming
 * 3. Find environment mapping to get cluster
 * 4. Create topic in Payload with status 'provisioning'
 * 5. Call Go service to create topic on Kafka cluster
 * 6. Update Payload topic status to 'active' or 'failed'
 */
export async function createTopic(input: CreateTopicInput): Promise<CreateTopicResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Get workspace for slug (used in topic naming)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspace = await (payload.findByID as any)({
    collection: 'workspaces',
    id: input.workspaceId,
  })

  if (!workspace) {
    return { success: false, error: 'Workspace not found' }
  }

  // Find environment mapping to get cluster
  const mappingsResult = await payload.find({
    collection: 'kafka-environment-mappings',
    where: {
      environment: { equals: input.environment },
    },
    depth: 1,
    limit: 1,
    sort: '-priority', // Higher priority first
  })

  if (mappingsResult.docs.length === 0) {
    return {
      success: false,
      error: `No Kafka cluster configured for environment '${input.environment}'. Please contact an administrator.`,
    }
  }

  const mapping = mappingsResult.docs[0]
  const cluster = typeof mapping.cluster === 'object' ? mapping.cluster : null

  if (!cluster) {
    return { success: false, error: 'Cluster not found in environment mapping' }
  }

  // Build full topic name: environment.workspace-slug.topic-name
  const fullTopicName = `${input.environment}.${workspace.slug}.${input.name}`

  // Build topic config
  const topicConfig: Record<string, string> = {
    'retention.ms': String(input.retentionMs || 604800000),
    'cleanup.policy': input.cleanupPolicy || 'delete',
    ...(input.compression && input.compression !== 'none' ? { 'compression.type': input.compression } : {}),
    ...(input.config || {}),
  }

  // Get bootstrap servers from cluster connection config
  const connectionConfig = (cluster.connectionConfig as { bootstrapServers?: string }) || {}
  const bootstrapServers = connectionConfig.bootstrapServers || ''

  // Create topic in Payload with status 'provisioning'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (payload.create as any)({
    collection: 'kafka-topics',
    data: {
      workspace: input.workspaceId,
      name: input.name,
      description: input.description,
      environment: input.environment,
      cluster: cluster.id,
      fullTopicName,
      partitions: input.partitions || 3,
      replicationFactor: input.replicationFactor || 3,
      retentionMs: input.retentionMs || 604800000,
      cleanupPolicy: input.cleanupPolicy || 'delete',
      compression: input.compression || 'none',
      config: topicConfig,
      status: 'provisioning',
      approvalRequired: false, // Auto-approve for MVP
      createdBy: userId,
    },
  })

  // Trigger Temporal workflow to provision topic
  try {
    const workflowId = await triggerTopicProvisioningWorkflow(created.id, {
      topicId: created.id,
      virtualClusterId: '', // Not using virtual clusters in this path
      topicPrefix: `${input.environment}.${workspace.slug}.`,
      topicName: input.name,
      partitions: input.partitions || 3,
      replicationFactor: input.replicationFactor || 3,
      retentionMs: input.retentionMs || 604800000,
      cleanupPolicy: input.cleanupPolicy || 'delete',
      compression: input.compression || 'none',
      config: topicConfig,
      bootstrapServers,
    })

    // Store workflow ID on the topic record for tracking
    if (workflowId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (payload.update as any)({
        collection: 'kafka-topics',
        id: created.id,
        data: {
          workflowId: workflowId,
        },
      })
    }

    // Re-fetch to get full topic data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedTopic = await (payload.findByID as any)({
      collection: 'kafka-topics',
      id: created.id,
      depth: 1,
    })

    revalidatePath(`/workspaces/[slug]/kafka`)

    return {
      success: true,
      topic: mapPayloadTopicToKafkaTopic(updatedTopic as PayloadKafkaTopic),
      workflowId: workflowId || undefined,
    }
  } catch (error) {
    console.error('Failed to start topic provisioning workflow:', error)

    // Update topic status to failed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.update as any)({
      collection: 'kafka-topics',
      id: created.id,
      data: {
        status: 'failed',
        provisioningError: error instanceof Error ? error.message : 'Failed to start provisioning workflow',
      },
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start provisioning workflow',
    }
  }
}

export interface ListTopicsInput {
  workspaceId: string
  environment?: string
  status?: string
  limit?: number
  offset?: number
}

export interface ListTopicsResult {
  success: boolean
  topics?: KafkaTopic[]
  total?: number
  error?: string
}

/**
 * List Kafka topics for a workspace from Payload CMS.
 */
export async function listTopics(input: ListTopicsInput): Promise<ListTopicsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Build query filters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereConditions: any[] = [{ workspace: { equals: input.workspaceId } }]

  if (input.environment) {
    whereConditions.push({ environment: { equals: input.environment } })
  }

  if (input.status) {
    // Map from API format (pending_approval) to Payload format (pending-approval)
    const statusMap: Record<string, string> = {
      pending_approval: 'pending-approval',
      provisioning: 'provisioning',
      active: 'active',
      failed: 'failed',
      deleting: 'deleting',
    }
    whereConditions.push({ status: { equals: statusMap[input.status] || input.status } })
  }

  try {
    const topicsResult = await payload.find({
      collection: 'kafka-topics',
      where: { and: whereConditions },
      limit: input.limit || 100,
      page: input.offset ? Math.floor(input.offset / (input.limit || 100)) + 1 : 1,
      sort: '-createdAt',
      depth: 1,
    })

    const topics = topicsResult.docs.map((doc) =>
      mapPayloadTopicToKafkaTopic(doc as unknown as PayloadKafkaTopic)
    )

    return {
      success: true,
      topics,
      total: topicsResult.totalDocs,
    }
  } catch (error) {
    console.error('Failed to list Kafka topics:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list topics',
    }
  }
}

export interface GetTopicResult {
  success: boolean
  topic?: KafkaTopic
  error?: string
}

/**
 * Get a single Kafka topic by ID from Payload CMS.
 */
export async function getTopic(topicId: string): Promise<GetTopicResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  try {
    const payload = await getPayload({ config })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topic = await (payload.findByID as any)({
      collection: 'kafka-topics',
      id: topicId,
      depth: 1,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    // Check workspace membership
    const workspaceId = typeof topic.workspace === 'object' ? topic.workspace.id : topic.workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: userId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    return {
      success: true,
      topic: mapPayloadTopicToKafkaTopic(topic as PayloadKafkaTopic),
    }
  } catch (error) {
    console.error('Failed to get Kafka topic:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get topic',
    }
  }
}

export interface UpdateTopicInput {
  topicId: string
  partitions?: number
  retentionMs?: number
  config?: Record<string, string>
  description?: string
}

export interface UpdateTopicResult {
  success: boolean
  topic?: KafkaTopic
  error?: string
}

/**
 * Update a Kafka topic
 */
export async function updateTopic(input: UpdateTopicInput): Promise<UpdateTopicResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Not implemented' }
}

export interface DeleteTopicResult {
  success: boolean
  workflowId?: string
  error?: string
}

/**
 * Delete a Kafka topic.
 *
 * Flow:
 * 1. Get topic from Payload
 * 2. Verify workspace membership (owner/admin role required)
 * 3. Update status to 'deleting'
 * 4. Call Go service to delete from Kafka cluster
 * 5. Delete from Payload
 */
export async function deleteTopic(topicId: string): Promise<DeleteTopicResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  try {
    // Get topic from Payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topic = await (payload.findByID as any)({
      collection: 'kafka-topics',
      id: topicId,
      depth: 1,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    const workspaceId = typeof topic.workspace === 'object' ? topic.workspace.id : topic.workspace

    // Check workspace membership (owner/admin required for delete)
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: userId } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Permission denied. You must be an admin or owner of this workspace.' }
    }

    // Trigger Temporal workflow to delete topic
    const clusterId = typeof topic.cluster === 'object' ? topic.cluster?.id : topic.cluster

    const workflowId = await triggerTopicDeletionWorkflow(topicId, {
      topicId,
      fullName: topic.fullTopicName || '',
      clusterId: clusterId || undefined,
    })

    // Update status to 'deleting' and store workflow ID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.update as any)({
      collection: 'kafka-topics',
      id: topicId,
      data: {
        status: 'deleting',
        workflowId: workflowId,
      },
    })

    revalidatePath(`/workspaces/[slug]/kafka`)

    return { success: true }
  } catch (error) {
    console.error('Failed to delete Kafka topic:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete topic',
    }
  }
}

export interface ApproveTopicResult {
  success: boolean
  topic?: KafkaTopic
  workflowId?: string
  error?: string
}

/**
 * Approve a pending Kafka topic
 */
export async function approveTopic(topicId: string): Promise<ApproveTopicResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Not implemented' }
}

// ============================================================================
// Schema Management Actions
// ============================================================================

export interface RegisterSchemaInput {
  topicId: string
  type: 'key' | 'value'
  format: 'avro' | 'protobuf' | 'json'
  content: string
  compatibility?: 'backward' | 'forward' | 'full' | 'none'
}

export interface RegisterSchemaResult {
  success: boolean
  schema?: KafkaSchema
  error?: string
}

/**
 * Register a new schema for a topic
 */
export async function registerSchema(input: RegisterSchemaInput): Promise<RegisterSchemaResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  try {
    // 1. Fetch topic to get workspace ID
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: input.topicId,
      depth: 1,
      overrideAccess: true,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    const workspaceId = typeof topic.workspace === 'string'
      ? topic.workspace
      : topic.workspace.id

    // 2. Create schema record in Payload (status: pending)
    const schema = await payload.create({
      collection: 'kafka-schemas',
      data: {
        workspace: workspaceId,
        topic: input.topicId,
        type: input.type,
        format: input.format,
        content: input.content,
        compatibility: input.compatibility || 'backward',
        status: 'pending',
      },
      overrideAccess: true,
    })

    // 3. Start Temporal workflow
    const client = await getTemporalClient()
    const workflowId = `schema-validation-${schema.id}`

    await client.workflow.start('SchemaValidationWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [{
        SchemaID: schema.id,
        TopicID: input.topicId,
        WorkspaceID: workspaceId,
        Type: input.type,
        Format: input.format,
        Content: input.content,
        Compatibility: input.compatibility || 'backward',
        AutoRegister: true,
      }],
    })

    console.log(`[Kafka] Started SchemaValidationWorkflow: ${workflowId}`)

    // 4. Return success with schema info
    return {
      success: true,
      schema: {
        id: schema.id,
        workspaceId: workspaceId,
        topicId: input.topicId,
        subject: schema.subject || '',
        type: schema.type as 'key' | 'value',
        format: schema.format as 'avro' | 'protobuf' | 'json',
        version: schema.version || 0,
        schemaId: schema.schemaId || 0,
        content: schema.content,
        compatibility: schema.compatibility as 'backward' | 'forward' | 'full' | 'none',
        status: schema.status as string,
        createdAt: schema.createdAt,
        updatedAt: schema.updatedAt,
      },
    }
  } catch (error) {
    console.error('[Kafka] Failed to register schema:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register schema',
    }
  }
}

export interface ListSchemasResult {
  success: boolean
  schemas?: KafkaSchema[]
  error?: string
}

/**
 * List schemas for a topic
 */
export async function listSchemas(topicId: string): Promise<ListSchemasResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, schemas: [] }
}

export interface GetSchemaResult {
  success: boolean
  schema?: KafkaSchema
  error?: string
}

/**
 * Get a schema by ID
 */
export async function getSchema(schemaId: string): Promise<GetSchemaResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Schema not found' }
}

export interface CheckCompatibilityInput {
  topicId: string
  type: 'key' | 'value'
  format: 'avro' | 'protobuf' | 'json'
  content: string
}

export interface CheckCompatibilityResult {
  success: boolean
  compatible?: boolean
  error?: string
}

/**
 * Check if a schema is compatible with existing schemas
 */
export async function checkSchemaCompatibility(
  input: CheckCompatibilityInput
): Promise<CheckCompatibilityResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, compatible: true }
}

// ============================================================================
// Topic Sharing Actions
// ============================================================================

export interface RequestTopicAccessInput {
  topicId: string
  requestingWorkspaceId: string
  permission: 'read' | 'write' | 'read_write'
  justification: string
}

export interface RequestTopicAccessResult {
  success: boolean
  share?: KafkaTopicShare
  error?: string
}

/**
 * Request access to a topic from another workspace
 */
export async function requestTopicAccess(
  input: RequestTopicAccessInput
): Promise<RequestTopicAccessResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.requestingWorkspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of the requesting workspace' }
  }

  // TODO: Call actual gRPC service when available
  const mockShare: KafkaTopicShare = {
    id: `share-${Date.now()}`,
    topicId: input.topicId,
    sharedWithType: 'workspace',
    sharedWithWorkspaceId: input.requestingWorkspaceId,
    permission: input.permission,
    status: 'pending_request',
    requestedBy: userId,
    requestedAt: new Date().toISOString(),
    justification: input.justification,
  }

  return { success: true, share: mockShare }
}

export interface ApproveTopicAccessInput {
  shareId: string
}

export interface ApproveTopicAccessResult {
  success: boolean
  share?: KafkaTopicShare
  error?: string
}

/**
 * Approve a topic access request
 */
export async function approveTopicAccess(
  input: ApproveTopicAccessInput
): Promise<ApproveTopicAccessResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  // Need to verify user is admin/owner of topic-owning workspace
  return { success: false, error: 'Not implemented' }
}

export interface RevokeTopicAccessResult {
  success: boolean
  error?: string
}

/**
 * Revoke topic access
 */
export async function revokeTopicAccess(shareId: string): Promise<RevokeTopicAccessResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true }
}

export interface ListTopicSharesInput {
  topicId?: string
  workspaceId?: string
  status?: 'pending_request' | 'approved' | 'rejected' | 'revoked'
}

export interface ListTopicSharesResult {
  success: boolean
  shares?: KafkaTopicShare[]
  error?: string
}

/**
 * List topic shares
 */
export async function listTopicShares(
  input: ListTopicSharesInput
): Promise<ListTopicSharesResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, shares: [] }
}

// ============================================================================
// Discovery Actions
// ============================================================================

export interface DiscoverTopicsInput {
  requestingWorkspaceId: string
  environment?: string
  search?: string
  schemaFormat?: 'avro' | 'protobuf' | 'json'
  limit?: number
  offset?: number
}

export interface DiscoverTopicsResult {
  success: boolean
  topics?: DiscoverableTopic[]
  total?: number
  error?: string
}

/**
 * Discover topics that can be accessed by a workspace
 */
export async function discoverTopics(
  input: DiscoverTopicsInput
): Promise<DiscoverTopicsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.requestingWorkspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, topics: [], total: 0 }
}

// ============================================================================
// Metrics & Lineage Actions
// ============================================================================

export interface TopicMetrics {
  id: string
  topicId: string
  period: string
  periodType: string
  bytesIn: number
  bytesOut: number
  messageCountIn: number
  messageCountOut: number
  storageBytes: number
  partitionCount: number
}

export interface GetTopicMetricsInput {
  topicId: string
  periodType?: 'hour' | 'day' | 'week' | 'month'
  periods?: number
}

export interface GetTopicMetricsResult {
  success: boolean
  metrics?: TopicMetrics[]
  error?: string
}

/**
 * Get topic metrics
 */
export async function getTopicMetrics(
  input: GetTopicMetricsInput
): Promise<GetTopicMetricsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, metrics: [] }
}

export interface LineageNode {
  workspaceId: string
  workspaceName: string
  serviceAccountId: string
  serviceAccountName: string
  clientId: string
  bytesTransferred: number
  lastSeen: string
}

export interface GetTopicLineageResult {
  success: boolean
  producers?: LineageNode[]
  consumers?: LineageNode[]
  error?: string
}

/**
 * Get topic lineage (producers and consumers)
 */
export async function getTopicLineage(topicId: string): Promise<GetTopicLineageResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, producers: [], consumers: [] }
}

// ============================================================================
// Service Account Actions
// ============================================================================

export interface CreateServiceAccountInput {
  workspaceId: string
  name: string
  type: 'producer' | 'consumer' | 'producer_consumer' | 'admin'
}

export interface ServiceAccount {
  id: string
  workspaceId: string
  name: string
  type: 'producer' | 'consumer' | 'producer_consumer' | 'admin'
  status: string
  createdBy: string
  createdAt: string
}

export interface CreateServiceAccountResult {
  success: boolean
  serviceAccount?: ServiceAccount
  apiKey?: string
  apiSecret?: string
  error?: string
}

/**
 * Create a service account for Kafka access
 */
export async function createServiceAccount(
  input: CreateServiceAccountInput
): Promise<CreateServiceAccountResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  // Check workspace membership with admin/owner role
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: userId } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return {
      success: false,
      error: 'Permission denied. You must be an admin or owner of this workspace.',
    }
  }

  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Not implemented' }
}

export interface ListServiceAccountsResult {
  success: boolean
  serviceAccounts?: ServiceAccount[]
  error?: string
}

/**
 * List service accounts for a workspace
 */
export async function listServiceAccounts(
  workspaceId: string
): Promise<ListServiceAccountsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const userId = session.user.id

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true, serviceAccounts: [] }
}

export interface RevokeServiceAccountResult {
  success: boolean
  error?: string
}

/**
 * Revoke a service account
 */
export async function revokeServiceAccount(
  serviceAccountId: string
): Promise<RevokeServiceAccountResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  return { success: true }
}

// ============================================================================
// Admin Actions (Cluster & Provider Management)
// ============================================================================

export interface KafkaProvider {
  id: string
  name: string
  displayName: string
  adapterType: string
  requiredConfigFields: string[]
  capabilities: {
    schemaRegistry: boolean
    transactions: boolean
    quotasApi: boolean
    metricsApi: boolean
  }
  documentationUrl: string
  iconUrl: string
}

export interface ListProvidersResult {
  success: boolean
  providers?: KafkaProvider[]
  error?: string
}

/**
 * List available Kafka providers (admin only)
 */
export async function listProviders(): Promise<ListProvidersResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Call actual gRPC service when available
  // This would list providers like Confluent Cloud, AWS MSK, etc.
  return { success: true, providers: [] }
}

export interface KafkaCluster {
  id: string
  name: string
  providerId: string
  connectionConfig: Record<string, string>
  validationStatus: 'pending' | 'valid' | 'invalid'
  lastValidatedAt?: string
  createdAt: string
  updatedAt: string
}

export interface RegisterClusterInput {
  name: string
  providerId: string
  connectionConfig: Record<string, string>
  credentials: Record<string, string>
}

export interface RegisterClusterResult {
  success: boolean
  cluster?: KafkaCluster
  error?: string
}

/**
 * Register a Kafka cluster (platform admin only)
 */
export async function registerCluster(
  input: RegisterClusterInput
): Promise<RegisterClusterResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Verify platform admin role
  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Not implemented' }
}

export interface ListClustersResult {
  success: boolean
  clusters?: KafkaCluster[]
  error?: string
}

/**
 * List Kafka clusters (platform admin only)
 */
export async function listClusters(): Promise<ListClustersResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Verify platform admin role
  // TODO: Call actual gRPC service when available
  return { success: true, clusters: [] }
}

export interface ValidateClusterResult {
  success: boolean
  valid?: boolean
  error?: string
}

/**
 * Validate a Kafka cluster connection (platform admin only)
 */
export async function validateCluster(clusterId: string): Promise<ValidateClusterResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Verify platform admin role
  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Not implemented' }
}

export interface DeleteClusterResult {
  success: boolean
  error?: string
}

/**
 * Delete a Kafka cluster (platform admin only)
 */
export async function deleteCluster(clusterId: string): Promise<DeleteClusterResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // TODO: Verify platform admin role
  // TODO: Call actual gRPC service when available
  return { success: false, error: 'Not implemented' }
}

// ============================================================================
// Temporal Workflow Helpers
// ============================================================================

/**
 * Input type for TopicProvisioningWorkflow (must match Go struct)
 */
type TopicProvisioningWorkflowInput = {
  TopicID: string
  VirtualClusterID: string
  TopicPrefix: string
  TopicName: string
  Partitions: number
  ReplicationFactor: number
  RetentionMs: number
  CleanupPolicy: string
  Compression: string
  Config: Record<string, string>
  BootstrapServers: string
}

/**
 * Input type for TopicDeletionWorkflow (must match Go struct)
 */
type TopicDeletionWorkflowInput = {
  TopicID: string
  PhysicalName: string
  ClusterID: string
}

async function triggerTopicProvisioningWorkflow(
  topicId: string,
  input: {
    topicId: string
    virtualClusterId: string
    topicPrefix: string
    topicName: string
    partitions: number
    replicationFactor: number
    retentionMs: number
    cleanupPolicy: string
    compression: string
    config: Record<string, string>
    bootstrapServers: string
  }
): Promise<string | null> {
  const workflowId = `topic-provision-${topicId}`

  // Transform input to match Go struct field names (PascalCase)
  const workflowInput: TopicProvisioningWorkflowInput = {
    TopicID: input.topicId,
    VirtualClusterID: input.virtualClusterId,
    TopicPrefix: input.topicPrefix,
    TopicName: input.topicName,
    Partitions: input.partitions,
    ReplicationFactor: input.replicationFactor,
    RetentionMs: input.retentionMs,
    CleanupPolicy: input.cleanupPolicy,
    Compression: input.compression,
    Config: input.config,
    BootstrapServers: input.bootstrapServers,
  }

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('TopicProvisioningWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [workflowInput],
    })

    console.log(
      `[Kafka] Started TopicProvisioningWorkflow: ${handle.workflowId} for topic ${input.topicName}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start TopicProvisioningWorkflow:', error)
    // Don't throw - the topic record is already created with status 'provisioning'
    // The workflow can be retried manually if needed
    return null
  }
}

async function triggerTopicDeletionWorkflow(
  topicId: string,
  input: {
    topicId: string
    fullName: string
    clusterId?: string
  }
): Promise<string | null> {
  const workflowId = `topic-deletion-${topicId}`

  // Transform input to match Go struct field names (PascalCase)
  const workflowInput: TopicDeletionWorkflowInput = {
    TopicID: input.topicId,
    PhysicalName: input.fullName,
    ClusterID: input.clusterId ?? '',
  }

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('TopicDeletionWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [workflowInput],
    })

    console.log(`[Kafka] Started TopicDeletionWorkflow: ${handle.workflowId} for topic ${topicId}`)

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start TopicDeletionWorkflow:', error)
    return null
  }
}
