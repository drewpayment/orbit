import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

interface CreateRegistryImageBody {
  workspace: string
  app: string
  tag: string
  digest: string
  sizeBytes: number
  pushedAt?: string
}

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const body: CreateRegistryImageBody = await request.json()

    // Validate required fields
    if (!body.workspace) {
      return NextResponse.json(
        { error: 'workspace is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    if (!body.app) {
      return NextResponse.json(
        { error: 'app is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    if (!body.tag) {
      return NextResponse.json(
        { error: 'tag is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Check if image already exists (upsert by workspace+app+tag)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (payload as any).find({
      collection: 'registry-images',
      where: {
        and: [
          { workspace: { equals: body.workspace } },
          { app: { equals: body.app } },
          { tag: { equals: body.tag } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      // Update existing image record
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await (payload as any).update({
        collection: 'registry-images',
        id: existing.docs[0].id,
        data: {
          digest: body.digest,
          sizeBytes: body.sizeBytes,
          pushedAt: body.pushedAt || new Date().toISOString(),
        },
        overrideAccess: true,
      })

      console.log(
        `[Internal API] Registry image updated: ${body.workspace}/${body.app}:${body.tag}`
      )

      return NextResponse.json({
        success: true,
        image: {
          id: updated.id,
          tag: updated.tag,
          digest: updated.digest,
          sizeBytes: updated.sizeBytes,
          pushedAt: updated.pushedAt,
        },
      })
    }

    // Create new image record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const image = await (payload as any).create({
      collection: 'registry-images',
      data: {
        workspace: body.workspace,
        app: body.app,
        tag: body.tag,
        digest: body.digest,
        sizeBytes: body.sizeBytes,
        pushedAt: body.pushedAt || new Date().toISOString(),
      },
      overrideAccess: true,
    })

    console.log(
      `[Internal API] Registry image created: ${body.workspace}/${body.app}:${body.tag}`
    )

    return NextResponse.json(
      {
        success: true,
        image: {
          id: image.id,
          tag: image.tag,
          digest: image.digest,
          sizeBytes: image.sizeBytes,
          pushedAt: image.pushedAt,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Internal API] Registry image creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
