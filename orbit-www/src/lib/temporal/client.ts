import { Client, Connection } from '@temporalio/client';

let temporalClient: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    
    temporalClient = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });
  }
  
  return temporalClient;
}

export async function closeTemporalClient(): Promise<void> {
  if (temporalClient) {
    await temporalClient.connection.close();
    temporalClient = null;
  }
}

/**
 * Start GitHub token refresh workflow
 */
export async function startGitHubTokenRefreshWorkflow(installationId: string): Promise<string> {
  const client = await getTemporalClient()

  const workflowId = `github-token-refresh:${installationId}`

  const handle = await client.workflow.start('GitHubTokenRefreshWorkflow', {
    taskQueue: 'orbit-workflows',
    args: [{
      InstallationID: installationId,
    }],
    workflowId,
    // Run indefinitely until cancelled
  })

  return handle.workflowId
}

/**
 * Cancel GitHub token refresh workflow
 */
export async function cancelGitHubTokenRefreshWorkflow(workflowId: string): Promise<void> {
  const client = await getTemporalClient()
  const handle = client.workflow.getHandle(workflowId)
  await handle.cancel()
}

/**
 * Input type for VirtualClusterProvisionWorkflow (must match Go struct)
 */
interface VirtualClusterProvisionWorkflowInput {
  ApplicationID: string
  ApplicationSlug: string
  WorkspaceID: string
  WorkspaceSlug: string
}

/**
 * Triggers the VirtualClusterProvisionWorkflow to create dev, stage, and prod virtual clusters
 * for a newly created Kafka application.
 *
 * Returns the workflow ID on success, or null if the workflow failed to start.
 * Does not throw — the caller should handle a null return gracefully.
 */
export async function startVirtualClusterProvisionWorkflow(input: {
  applicationId: string
  applicationSlug: string
  workspaceId: string
  workspaceSlug: string
}): Promise<string | null> {
  const workflowId = `virtual-cluster-provision-${input.applicationId}`

  const workflowInput: VirtualClusterProvisionWorkflowInput = {
    ApplicationID: input.applicationId,
    ApplicationSlug: input.applicationSlug,
    WorkspaceID: input.workspaceId,
    WorkspaceSlug: input.workspaceSlug,
  }

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('VirtualClusterProvisionWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [workflowInput],
    })

    console.log(
      `[Kafka] Started VirtualClusterProvisionWorkflow: ${handle.workflowId} for app ${input.applicationSlug}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start VirtualClusterProvisionWorkflow:', error)
    return null
  }
}