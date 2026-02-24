import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { auth } from '@/lib/auth'
import { hasUsers, resetSetupCache } from '@/lib/setup'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  if (await hasUsers()) {
    return NextResponse.json(
      { error: 'Setup has already been completed' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const { name, email, password, workspaceName } = body

  if (!name || !email || !password || !workspaceName) {
    return NextResponse.json(
      { error: 'Missing required fields: name, email, password, workspaceName' },
      { status: 400 }
    )
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }

  const slug = slugify(workspaceName)
  if (!slug) {
    return NextResponse.json(
      { error: 'Workspace name must contain at least one alphanumeric character' },
      { status: 400 }
    )
  }

  // Step 1: Create user in Better Auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authResult: any
  try {
    authResult = await auth.api.signUpEmail({
      body: { name, email, password },
    })
  } catch (error) {
    console.error('[setup] Better Auth signup failed:', error)
    return NextResponse.json({ error: 'Setup failed. Please try again.' }, { status: 500 })
  }

  // Step 2: Create all Payload records
  try {
    const payload = await getPayload({ config: configPromise })

    const payloadUser = await payload.create({
      collection: 'users',
      data: { email, name, password },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'tenants',
      data: {
        name: 'Default',
        slug: 'default',
        plan: 'self-hosted',
        status: 'active',
      },
      overrideAccess: true,
    })

    const workspace = await payload.create({
      collection: 'workspaces',
      data: { name: workspaceName, slug },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'workspace-members',
      data: {
        workspace: workspace.id,
        user: payloadUser.id,
        role: 'owner',
        status: 'active',
        requestedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    resetSetupCache()

    const response = NextResponse.json({ success: true })

    // Forward session cookies from Better Auth
    const cookies = (authResult.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    if (cookies?.length) {
      for (const cookie of cookies) {
        response.headers.append('set-cookie', cookie)
      }
    } else {
      const setCookie = authResult.headers?.get('set-cookie')
      if (setCookie) {
        response.headers.append('set-cookie', setCookie)
      }
    }

    return response
  } catch (error) {
    console.error('[setup] Payload operations failed:', error)

    // Compensating rollback: delete Better Auth user so setup can be retried
    if (authResult?.user?.id) {
      try {
        const { MongoClient } = await import('mongodb')
        const rollbackClient = new MongoClient(process.env.DATABASE_URI || '', {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
        })
        try {
          await rollbackClient.connect()
          await rollbackClient.db().collection('user').deleteOne({ id: authResult.user.id })
          console.error('[setup] Rolled back Better Auth user to allow retry')
        } finally {
          await rollbackClient.close()
        }
      } catch (rollbackError) {
        console.error('[setup] Rollback failed — manual DB cleanup required:', rollbackError)
      }
    }

    return NextResponse.json({ error: 'Setup failed. Please try again.' }, { status: 500 })
  }
}
