import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const payload = await getPayload({ config: configPromise })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id,
  })

  return NextResponse.json(installation)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const payload = await getPayload({ config: configPromise })

  const updated = await payload.update({
    collection: 'github-installations',
    id,
    data: body,
  })

  return NextResponse.json(updated)
}
