'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export type CreateTopicInput = {
  virtualClusterId: string
  name: string
  description?: string
  partitions: number
  replicationFactor: number
  retentionMs?: number
  cleanupPolicy?: 'delete' | 'compact' | 'compact,delete'
  compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd'
  config?: Record<string, string>
}

export type CreateTopicResult = {
  success: boolean
  topicId?: string
  error?: string
  policyViolations?: PolicyViolation[]
}

export type PolicyViolation = {
  field: string
  constraint: string
  message: string
  actualValue: string
  allowedValue: string
}

export async function createTopic(input: CreateTopicInput): Promise<CreateTopicResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // 1. Get the virtual cluster to find workspace and application
    const virtualCluster = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: input.virtualClusterId,
      depth: 2,
    })

    if (!virtualCluster) {
      return { success: false, error: 'Virtual cluster not found' }
    }

    const application =
      typeof virtualCluster.application === 'string'
        ? await payload.findByID({ collection: 'kafka-applications', id: virtualCluster.application })
        : virtualCluster.application

    if (!application) {
      return { success: false, error: 'Application not found' }
    }

    const workspaceId =
      typeof application.workspace === 'string' ? application.workspace : application.workspace.id

    // 2. Evaluate policies
    const violations = await evaluateTopicPolicies(payload, {
      workspaceId,
      environment: virtualCluster.environment,
      name: input.name,
      partitions: input.partitions,
      replicationFactor: input.replicationFactor,
      retentionMs: input.retentionMs,
      cleanupPolicy: input.cleanupPolicy,
    })

    if (violations.length > 0) {
      // Check if auto-approval is possible
      const canAutoApprove = await checkAutoApproval(
        payload,
        workspaceId,
        virtualCluster.environment,
        input
      )

      if (!canAutoApprove) {
        return {
          success: false,
          error: 'Topic request violates policies and requires approval',
          policyViolations: violations,
        }
      }
    }

    // 3. Create topic record
    const topic = await payload.create({
      collection: 'kafka-topics',
      data: {
        workspace: workspaceId,
        application: application.id,
        virtualCluster: input.virtualClusterId,
        name: input.name,
        description: input.description,
        environment: virtualCluster.environment,
        partitions: input.partitions,
        replicationFactor: input.replicationFactor,
        retentionMs: input.retentionMs ?? 604800000,
        cleanupPolicy: input.cleanupPolicy ?? 'delete',
        compression: input.compression ?? 'none',
        config: input.config ?? {},
        status: violations.length > 0 ? 'pending-approval' : 'provisioning',
        approvalRequired: violations.length > 0,
        createdVia: 'orbit-ui',
        fullTopicName: `${virtualCluster.topicPrefix}${input.name}`,
      },
      overrideAccess: true,
    })

    // 4. If no approval needed, trigger provisioning workflow
    if (violations.length === 0) {
      await triggerTopicProvisioningWorkflow(topic.id, {
        topicId: topic.id,
        workspaceId,
        environment: virtualCluster.environment,
        topicName: input.name,
        fullTopicName: `${virtualCluster.topicPrefix}${input.name}`,
        partitions: input.partitions,
        replicationFactor: input.replicationFactor,
        retentionMs: input.retentionMs ?? 604800000,
        cleanupPolicy: input.cleanupPolicy ?? 'delete',
        compression: input.compression ?? 'none',
        config: input.config ?? {},
      })
    }

    revalidatePath(`/[workspace]/kafka/applications/[appSlug]`)

    return {
      success: true,
      topicId: topic.id,
    }
  } catch (error) {
    console.error('Failed to create topic:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function listTopicsByVirtualCluster(virtualClusterId: string) {
  const payload = await getPayload({ config })

  const topics = await payload.find({
    collection: 'kafka-topics',
    where: {
      virtualCluster: { equals: virtualClusterId },
      status: { not_equals: 'deleted' },
    },
    sort: '-createdAt',
    limit: 100,
  })

  return topics.docs
}

export async function listTopicsByApplication(applicationId: string) {
  const payload = await getPayload({ config })

  const topics = await payload.find({
    collection: 'kafka-topics',
    where: {
      application: { equals: applicationId },
      status: { not_equals: 'deleted' },
    },
    sort: '-createdAt',
    limit: 100,
    depth: 1,
  })

  return topics.docs
}

export async function deleteTopic(topicId: string): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: topicId,
      depth: 1,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    if (topic.status === 'deleted' || topic.status === 'deleting') {
      return { success: false, error: 'Topic is already deleted or being deleted' }
    }

    // Update status to deleting
    await payload.update({
      collection: 'kafka-topics',
      id: topicId,
      data: {
        status: 'deleting',
      },
      overrideAccess: true,
    })

    // Trigger deletion workflow
    await triggerTopicDeletionWorkflow(topicId, {
      topicId,
      fullName: topic.fullTopicName ?? '',
      clusterId: typeof topic.cluster === 'string' ? topic.cluster : topic.cluster?.id,
    })

    revalidatePath(`/[workspace]/kafka/applications/[appSlug]`)

    return { success: true }
  } catch (error) {
    console.error('Failed to delete topic:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function approveTopic(
  topicId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: topicId,
      depth: 1,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    if (topic.status !== 'pending-approval') {
      return { success: false, error: 'Topic is not pending approval' }
    }

    // Update status and approval info
    await payload.update({
      collection: 'kafka-topics',
      id: topicId,
      data: {
        status: 'provisioning',
        approvedBy: userId,
        approvedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    // Get virtual cluster for context
    const virtualCluster =
      typeof topic.virtualCluster === 'string'
        ? await payload.findByID({ collection: 'kafka-virtual-clusters', id: topic.virtualCluster })
        : topic.virtualCluster

    // Trigger provisioning workflow
    await triggerTopicProvisioningWorkflow(topicId, {
      topicId,
      workspaceId: typeof topic.workspace === 'string' ? topic.workspace : topic.workspace.id,
      environment: virtualCluster?.environment ?? topic.environment,
      topicName: topic.name,
      fullTopicName: topic.fullTopicName ?? '',
      partitions: topic.partitions,
      replicationFactor: topic.replicationFactor,
      retentionMs: topic.retentionMs ?? 604800000,
      cleanupPolicy: topic.cleanupPolicy ?? 'delete',
      compression: topic.compression ?? 'none',
      config: (topic.config as Record<string, string>) ?? {},
    })

    revalidatePath(`/[workspace]/kafka/applications/[appSlug]`)

    return { success: true }
  } catch (error) {
    console.error('Failed to approve topic:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Helper functions

async function evaluateTopicPolicies(
  payload: Awaited<ReturnType<typeof getPayload>>,
  params: {
    workspaceId: string
    environment: string
    name: string
    partitions: number
    replicationFactor: number
    retentionMs?: number
    cleanupPolicy?: string
  }
): Promise<PolicyViolation[]> {
  // Find applicable policies (workspace-specific or platform-wide)
  const policies = await payload.find({
    collection: 'kafka-topic-policies',
    where: {
      and: [
        { enabled: { equals: true } },
        {
          or: [{ workspace: { equals: params.workspaceId } }, { workspace: { exists: false } }],
        },
      ],
    },
    sort: '-priority',
    limit: 10,
    overrideAccess: true,
  })

  const violations: PolicyViolation[] = []

  for (const policy of policies.docs) {
    // Check environment applicability
    const policyEnvs = policy.environment as string[] | undefined
    if (policyEnvs?.length && !policyEnvs.includes(params.environment)) {
      continue
    }

    // Check naming conventions
    const namingConventions = policy.namingConventions as
      | { pattern?: string; maxLength?: number }
      | undefined
    if (namingConventions?.pattern) {
      const regex = new RegExp(namingConventions.pattern)
      if (!regex.test(params.name)) {
        violations.push({
          field: 'name',
          constraint: 'naming_pattern',
          message: `Topic name does not match required pattern: ${namingConventions.pattern}`,
          actualValue: params.name,
          allowedValue: namingConventions.pattern,
        })
      }
    }

    if (namingConventions?.maxLength && params.name.length > namingConventions.maxLength) {
      violations.push({
        field: 'name',
        constraint: 'max_name_length',
        message: `Topic name exceeds maximum length of ${namingConventions.maxLength}`,
        actualValue: params.name.length.toString(),
        allowedValue: namingConventions.maxLength.toString(),
      })
    }

    // Check partition limits
    const partitionLimits = policy.partitionLimits as { max?: number; min?: number } | undefined
    if (partitionLimits?.max && params.partitions > partitionLimits.max) {
      violations.push({
        field: 'partitions',
        constraint: 'max_partitions',
        message: `Partition count ${params.partitions} exceeds maximum ${partitionLimits.max}`,
        actualValue: params.partitions.toString(),
        allowedValue: partitionLimits.max.toString(),
      })
    }

    if (partitionLimits?.min && params.partitions < partitionLimits.min) {
      violations.push({
        field: 'partitions',
        constraint: 'min_partitions',
        message: `Partition count ${params.partitions} below minimum ${partitionLimits.min}`,
        actualValue: params.partitions.toString(),
        allowedValue: partitionLimits.min.toString(),
      })
    }

    // Check replication limits
    const replicationLimits = policy.replicationLimits as { min?: number } | undefined
    if (replicationLimits?.min && params.replicationFactor < replicationLimits.min) {
      violations.push({
        field: 'replication_factor',
        constraint: 'min_replication_factor',
        message: `Replication factor ${params.replicationFactor} below minimum ${replicationLimits.min}`,
        actualValue: params.replicationFactor.toString(),
        allowedValue: replicationLimits.min.toString(),
      })
    }

    // Check retention limits
    const retentionLimits = policy.retentionLimits as { maxMs?: number } | undefined
    if (params.retentionMs && retentionLimits?.maxMs && params.retentionMs > retentionLimits.maxMs) {
      violations.push({
        field: 'retention.ms',
        constraint: 'max_retention_ms',
        message: `Retention ${params.retentionMs}ms exceeds maximum ${retentionLimits.maxMs}ms`,
        actualValue: params.retentionMs.toString(),
        allowedValue: retentionLimits.maxMs.toString(),
      })
    }

    // Check cleanup policy
    const allowedCleanupPolicies = policy.allowedCleanupPolicies as string[] | undefined
    if (params.cleanupPolicy && allowedCleanupPolicies?.length) {
      if (!allowedCleanupPolicies.includes(params.cleanupPolicy)) {
        violations.push({
          field: 'cleanup.policy',
          constraint: 'allowed_cleanup_policies',
          message: `Cleanup policy '${params.cleanupPolicy}' not allowed. Allowed: ${allowedCleanupPolicies.join(', ')}`,
          actualValue: params.cleanupPolicy,
          allowedValue: allowedCleanupPolicies.join(', '),
        })
      }
    }

    // If this policy has violations and requires approval, break
    if (violations.length > 0 && policy.requireApproval) {
      break
    }
  }

  return violations
}

async function checkAutoApproval(
  payload: Awaited<ReturnType<typeof getPayload>>,
  workspaceId: string,
  environment: string,
  input: CreateTopicInput
): Promise<boolean> {
  const policies = await payload.find({
    collection: 'kafka-topic-policies',
    where: {
      and: [
        { enabled: { equals: true } },
        {
          or: [{ workspace: { equals: workspaceId } }, { workspace: { exists: false } }],
        },
      ],
    },
    sort: '-priority',
    limit: 10,
    overrideAccess: true,
  })

  for (const policy of policies.docs) {
    const autoApprovalRules = policy.autoApprovalRules as
      | Array<{
          environment?: string
          maxPartitions?: number
          topicPattern?: string
        }>
      | undefined

    if (!autoApprovalRules?.length) continue

    for (const rule of autoApprovalRules) {
      if (rule.environment && rule.environment !== environment) continue

      // Check if topic meets auto-approval criteria
      if (rule.maxPartitions && input.partitions <= rule.maxPartitions) {
        if (!rule.topicPattern || new RegExp(rule.topicPattern).test(input.name)) {
          return true
        }
      }
    }
  }

  return false
}

async function triggerTopicProvisioningWorkflow(
  topicId: string,
  input: {
    topicId: string
    workspaceId: string
    environment: string
    topicName: string
    fullTopicName: string
    partitions: number
    replicationFactor: number
    retentionMs: number
    cleanupPolicy: string
    compression: string
    config: Record<string, string>
  }
) {
  // TODO: Implement Temporal client call
  // For now, log the workflow trigger
  console.log('Triggering TopicProvisioningWorkflow:', input)

  // In production, this would call the Temporal client:
  // const client = await getTemporalClient()
  // await client.workflow.start(TopicProvisioningWorkflow, {
  //   taskQueue: 'kafka-topic-provisioning',
  //   workflowId: `topic-provision-${topicId}`,
  //   args: [input],
  // })
}

async function triggerTopicDeletionWorkflow(
  topicId: string,
  input: {
    topicId: string
    fullName: string
    clusterId?: string
  }
) {
  // TODO: Implement Temporal client call
  console.log('Triggering TopicDeletionWorkflow:', input)
}
