import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

let temporalClient: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      connectTimeout: 5000,
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

export function gitHubTokenRefreshWorkflowId(installationId: string): string {
  return `github-token-refresh:${installationId}`
}

/**
 * Ensure the GitHub token refresh workflow is running for an installation.
 *
 * Idempotent: the deterministic workflow id plus USE_EXISTING means concurrent
 * callers (install hook, install callback, unsuspend webhook, reconciliation
 * sweeper) all converge on a single running workflow. An already-running
 * workflow is treated as success, not an error.
 *
 * @returns the workflow id on success, or null on a real failure (caller should
 *          degrade gracefully; the reconciliation sweeper will recover it).
 */
export async function ensureGitHubTokenRefreshWorkflow(installationId: string): Promise<string | null> {
  const workflowId = gitHubTokenRefreshWorkflowId(installationId)
  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('GitHubTokenRefreshWorkflow', {
      taskQueue: 'orbit-workflows',
      args: [{ InstallationID: installationId }],
      workflowId,
      // Attach to the existing run instead of racing if one is already running.
      workflowIdConflictPolicy: 'USE_EXISTING',
      // Allow a fresh run to start after a previous one closed (uninstall → reinstall).
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    })

    return handle.workflowId
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return workflowId
    }
    console.error('[GitHub] Failed to ensure token refresh workflow:', error)
    return null
  }
}

/**
 * @deprecated Use {@link ensureGitHubTokenRefreshWorkflow}. Retained for callers
 * that expect a throwing, string-returning contract.
 */
export async function startGitHubTokenRefreshWorkflow(installationId: string): Promise<string> {
  const workflowId = await ensureGitHubTokenRefreshWorkflow(installationId)
  if (!workflowId) {
    // Reset cached client so the next attempt gets a fresh connection.
    temporalClient = null
    throw new Error(`Failed to start GitHub token refresh workflow for ${installationId}`)
  }
  return workflowId
}

/**
 * Nudge a running refresh workflow to refresh immediately (best-effort).
 * Used when a consumer reads a near-expired/expired token so the next read
 * self-heals. Never throws — a missing workflow is recovered by the sweeper.
 */
export async function signalGitHubTokenRefresh(installationId: string): Promise<void> {
  try {
    const client = await getTemporalClient()
    const handle = client.workflow.getHandle(gitHubTokenRefreshWorkflowId(installationId))
    await handle.signal('trigger-refresh')
  } catch (error) {
    console.warn('[GitHub] Failed to signal token refresh (sweeper will recover):', error)
  }
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