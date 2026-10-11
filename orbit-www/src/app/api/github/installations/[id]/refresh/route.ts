export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { authorize, authzErrorResponse } from '@/lib/authz'
import { getTemporalClient } from '@/lib/temporal/client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Platform-admin only (GitHub installations are platform resources).
  try {
    await authorize('manage', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

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

    // Check if workflow is running
    if (installation.temporalWorkflowStatus !== 'running') {
      return NextResponse.json(
        {
          error: 'Token refresh workflow is not running',
          status: installation.temporalWorkflowStatus
        },
        { status: 400 }
      )
    }

    // Send signal to workflow
    const client = await getTemporalClient()
    const workflowId = installation.temporalWorkflowId || `github-token-refresh:${id}`

    try {
      const handle = client.workflow.getHandle(workflowId)
      await handle.signal('trigger-refresh')
    } catch (workflowError) {
      console.error('[GitHub Token Refresh] Failed to signal workflow:', workflowError)
      return NextResponse.json(
        {
          error: 'Failed to signal workflow',
          details: workflowError instanceof Error ? workflowError.message : 'Unknown error'
        },
        { status: 500 }
      )
    }

    console.log('[GitHub Token Refresh] Manual refresh triggered for installation:', id)

    return NextResponse.json({
      status: 'success',
      message: 'Token refresh triggered. Check Temporal UI for results.',
      workflowId,
    })

  } catch (error) {
    console.error('[GitHub Token Refresh] Failed to trigger refresh:', error)
    return NextResponse.json(
      {
        error: 'Failed to trigger token refresh',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
