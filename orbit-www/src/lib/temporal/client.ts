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