import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const { id } = await params
    const payload = await getPayload({ config: configPromise })

    // Verify the image exists first
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (payload as any).findByID({
        collection: 'registry-images',
        id,
        overrideAccess: true,
      })
    } catch {
      return NextResponse.json(
        { error: 'Registry image not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Delete the image record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload as any).delete({
      collection: 'registry-images',
      id,
      overrideAccess: true,
    })

    console.log(`[Internal API] Registry image deleted: ${id}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Internal API] Registry image deletion error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Registry image not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
