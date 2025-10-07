import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload = await getPayload({ config })
    const body = await request.json()

    // Get the current user from the session (you'll need to implement session middleware)
    // For now, we'll accept the approvedBy from the request
    const updateData: any = { ...body }

    // If approving, set approvedAt timestamp
    if (body.status === 'active' && !updateData.approvedAt) {
      updateData.approvedAt = new Date().toISOString()
    }

    const result = await payload.update({
      collection: 'workspace-members',
      id: params.id,
      data: updateData,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating workspace member:', error)
    return NextResponse.json(
      { error: 'Failed to update workspace member' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload = await getPayload({ config })

    await payload.delete({
      collection: 'workspace-members',
      id: params.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting workspace member:', error)
    return NextResponse.json(
      { error: 'Failed to delete workspace member' },
      { status: 500 }
    )
  }
}
