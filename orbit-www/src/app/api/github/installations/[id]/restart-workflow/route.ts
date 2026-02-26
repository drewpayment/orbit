export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getTemporalClient, startGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

/**
 * Restart the GitHub token refresh workflow by terminating the old one and starting a new one.
 * This is useful when the workflow code has changed and the old workflow can't be replayed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Get Payload instance
    const payload = await getPayload({ config: configPromise })

    // Get installation to verify it exists
    const installation = await payload.findByID({
      collection: 'github-installations',
      id,
    })

    if (!installation) {
      return NextResponse.json(
        { error: 'Installation not found' },
        { status: 404 }
      )
    }

    const client = await getTemporalClient()
    const workflowId = installation.temporalWorkflowId || `github-token-refresh:${id}`

    // Step 1: Terminate the old workflow (if running)
    try {
      const handle = client.workflow.getHandle(workflowId)
      await handle.terminate('Restarting with updated workflow code')
      console.log('[GitHub Token Refresh] Terminated old workflow:', workflowId)
    } catch (terminateError) {
      // If workflow doesn't exist or is already terminated, that's fine
      console.log('[GitHub Token Refresh] Workflow already terminated or not found:', workflowId)
    }

    // Step 2: Start a new workflow using the same function as initial installation
    try {
      const newWorkflowId = await startGitHubTokenRefreshWorkflow(id)

      console.log('[GitHub Token Refresh] Started new workflow:', newWorkflowId)

      // Update installation status
      await payload.update({
        collection: 'github-installations',
        id,
        data: {
          temporalWorkflowId: newWorkflowId,
          temporalWorkflowStatus: 'running',
        },
      })

      return NextResponse.json({
        status: 'success',
        message: 'Workflow restarted successfully. The token will be refreshed shortly.',
        workflowId: newWorkflowId,
      })

    } catch (startError) {
      console.error('[GitHub Token Refresh] Failed to start new workflow:', startError)

      // Update installation status to failed
      await payload.update({
        collection: 'github-installations',
        id,
        data: {
          temporalWorkflowStatus: 'failed',
        },
      })

      return NextResponse.json(
        {
          error: 'Failed to start new workflow',
          details: startError instanceof Error ? startError.message : 'Unknown error'
        },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('[GitHub Token Refresh] Failed to restart workflow:', error)
    return NextResponse.json(
      {
        error: 'Failed to restart workflow',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
