import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { startGitHubTokenRefreshWorkflow } from '@/lib/temporal/client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const payload = await getPayload({ config: configPromise })

    // Get the installation
    const installation = await payload.findByID({
      collection: 'github-installations',
      id,
    })

    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    // Check if workflow is already running
    if (installation.temporalWorkflowStatus === 'running') {
      return NextResponse.json({
        message: 'Workflow already running',
        workflowId: installation.temporalWorkflowId,
      })
    }

    // Start the workflow
    const workflowId = await startGitHubTokenRefreshWorkflow(installation.id)

    // Update installation with workflow details
    await payload.update({
      collection: 'github-installations',
      id: installation.id,
      data: {
        temporalWorkflowId: workflowId,
        temporalWorkflowStatus: 'running',
      },
    })

    return NextResponse.json({
      message: 'Workflow started successfully',
      workflowId,
      status: 'running',
    })
  } catch (error) {
    console.error('[Retry Workflow] Error:', error)
    return NextResponse.json(
      { error: 'Failed to start workflow', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
