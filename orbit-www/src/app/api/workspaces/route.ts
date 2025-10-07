import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const searchParams = request.nextUrl.searchParams

    // Build query from search params
    const where: any = {}

    // Handle slug filter
    const slug = searchParams.get('where[slug][equals]')
    if (slug) {
      where.slug = { equals: slug }
    }

    const result = await payload.find({
      collection: 'workspaces',
      where,
      limit: 100,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching workspaces:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspaces' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const body = await request.json()

    const result = await payload.create({
      collection: 'workspaces',
      data: body,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('Error creating workspace:', error)
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 }
    )
  }
}
