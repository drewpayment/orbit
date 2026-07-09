import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { catalogScanWorkflowId, catalogScanAdoWorkflowId } from '@/lib/discovery/actions-core';

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
 * Nudge the refresh workflow to refresh immediately (best-effort).
 * Used when a consumer reads a near-expired/expired token so the next read
 * self-heals. Signal-with-start: a dead refresher (terminated, failed, never
 * started) is RESTARTED rather than warned about — a bare signal to a closed
 * workflow lands nowhere and previously left expired tokens stuck until a
 * sweeper pass noticed. Never throws.
 */
export async function signalGitHubTokenRefresh(installationId: string): Promise<void> {
  try {
    const client = await getTemporalClient()
    await client.workflow.signalWithStart('GitHubTokenRefreshWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId: gitHubTokenRefreshWorkflowId(installationId),
      args: [{ InstallationID: installationId }],
      signal: 'trigger-refresh',
      signalArgs: [],
    })
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
 * Input type for CatalogScanWorkflow (must match the Go
 * `CatalogScanWorkflowInput` struct — WP4/WP11).
 *
 * GitHub scans set only InstallationID (numeric, as string) + WorkspaceID.
 * Azure DevOps scans (WP11) set Provider 'azure-devops' + ConnectionID (the
 * git-connections doc id), and pass that SAME doc id as InstallationID so the
 * ingest dedupeKey shape is unchanged. Provider/ConnectionID are omitempty on
 * the Go side, so a GitHub call that leaves them unset is wire-identical to the
 * pre-WP11 contract.
 */
interface CatalogScanWorkflowInput {
  InstallationID: string
  WorkspaceID: string
  Provider?: 'github' | 'azure-devops'
  ConnectionID?: string
}

/**
 * Start (or attach to) a catalog scan. Idempotent "Scan now": the deterministic
 * workflow id + USE_EXISTING means a concurrent or repeat trigger converges on
 * the single running scan rather than racing. ALLOW_DUPLICATE lets a fresh run
 * start once a previous one has closed.
 *
 * GitHub (default): pass `{ installationId, workspaceId }`; the workflow id is
 * `catalog-scan-<installationId>`. Azure DevOps (WP11): pass
 * `{ installationId: connId, workspaceId: '', provider: 'azure-devops',
 * connectionId: connId }`; the workflow id is `catalog-scan-ado-<connId>`.
 *
 * @returns the workflow id on success, or null on a real failure (caller skips
 *          that target; the scan for the others still proceeds).
 */
export async function startCatalogScanWorkflow(input: {
  installationId: string
  workspaceId: string
  provider?: 'github' | 'azure-devops'
  connectionId?: string
}): Promise<string | null> {
  const isAdo = input.provider === 'azure-devops'
  const workflowId = isAdo
    ? catalogScanAdoWorkflowId(input.connectionId ?? input.installationId)
    : catalogScanWorkflowId(input.installationId)
  const workflowInput: CatalogScanWorkflowInput = {
    InstallationID: input.installationId,
    WorkspaceID: input.workspaceId,
    ...(input.provider ? { Provider: input.provider } : {}),
    ...(input.connectionId ? { ConnectionID: input.connectionId } : {}),
  }
  try {
    const client = await getTemporalClient()
    const handle = await client.workflow.start('CatalogScanWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [workflowInput],
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    })
    return handle.workflowId
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return workflowId
    console.error('[Discovery] Failed to start CatalogScanWorkflow:', error)
    return null
  }
}

export interface CatalogScanStatus {
  status: 'running' | 'completed' | 'failed' | 'none'
  /** Close time for a finished run, else the start time; ISO string. */
  lastRunAt?: string
}

/**
 * Best-effort status of an installation's catalog scan for the review-queue
 * banner. A missing workflow (never scanned) maps to `none`; any non-running,
 * non-completed terminal state (failed/canceled/terminated/timed out) maps to
 * `failed`. Never throws.
 */
export async function describeCatalogScanWorkflow(
  installationId: string,
  opts: { provider?: 'github' | 'azure-devops' } = {},
): Promise<CatalogScanStatus> {
  const workflowId =
    opts.provider === 'azure-devops'
      ? catalogScanAdoWorkflowId(installationId)
      : catalogScanWorkflowId(installationId)
  try {
    const client = await getTemporalClient()
    const desc = await client.workflow.getHandle(workflowId).describe()
    const statusName =
      typeof desc.status === 'string'
        ? desc.status
        : ((desc.status as { name?: string })?.name ?? '')
    const lastRunAt = (desc.closeTime ?? desc.startTime)?.toISOString?.()
    switch (statusName) {
      case 'RUNNING':
        return { status: 'running', lastRunAt }
      case 'COMPLETED':
        return { status: 'completed', lastRunAt }
      default:
        return { status: 'failed', lastRunAt }
    }
  } catch {
    return { status: 'none' }
  }
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