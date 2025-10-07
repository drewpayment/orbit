import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const searchParams = request.nextUrl.searchParams

    // Build query from search params
    const where: any = { and: [] }

    // Handle workspace filter
    const workspaceId = searchParams.get('where[workspace][equals]')
    if (workspaceId) {
      where.and.push({ workspace: { equals: workspaceId } })
    }

    // Handle user filter
    const userId = searchParams.get('where[user][equals]')
    if (userId) {
      where.and.push({ user: { equals: userId } })
    }

    // Handle status filter
    const status = searchParams.get('where[status][equals]')
    if (status) {
      where.and.push({ status: { equals: status } })
    }

    // Handle role filter
    const role = searchParams.get('where[role][in]')
    if (role) {
      where.and.push({ role: { in: role.split(',') } })
    }

    const result = await payload.find({
      collection: 'workspace-members',
      where: where.and.length > 0 ? where : {},
      depth: 2, // Include user and workspace data
      limit: 100,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching workspace members:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspace members' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const body = await request.json()

    const result = await payload.create({
      collection: 'workspace-members',
      data: body,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('Error creating workspace member:', error)
    return NextResponse.json(
      { error: 'Failed to create workspace member' },
      { status: 500 }
    )
  }
}
