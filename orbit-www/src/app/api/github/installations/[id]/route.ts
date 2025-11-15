import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = await getPayload({ config: configPromise })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id: params.id,
  })

  return NextResponse.json(installation)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json()
  const payload = await getPayload({ config: configPromise })

  const updated = await payload.update({
    collection: 'github-installations',
    id: params.id,
    data: body,
  })

  return NextResponse.json(updated)
}
