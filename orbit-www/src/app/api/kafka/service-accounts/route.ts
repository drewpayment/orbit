import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { createServiceAccount, listServiceAccounts } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/service-accounts
 * List service accounts for a workspace
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const result = await listServiceAccounts(workspaceId)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ serviceAccounts: result.serviceAccounts })
}

/**
 * POST /api/kafka/service-accounts
 * Create a new service account
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json()

    const { workspaceId, name, type } = body
    if (!workspaceId || !name || !type) {
      return NextResponse.json(
        { error: 'workspaceId, name, and type are required' },
        { status: 400 }
      )
    }

    const result = await createServiceAccount({
      workspaceId,
      name,
      type,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      serviceAccount: result.serviceAccount,
      apiKey: result.apiKey,
      apiSecret: result.apiSecret,
    })
  } catch (error) {
    console.error('[POST /api/kafka/service-accounts] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create service account' },
      { status: 500 }
    )
  }
}
