import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function GET() {
  const payload = await getPayload({ config: configPromise })

  const workspaces = await payload.find({
    collection: 'workspaces',
    sort: 'name',
  })

  return NextResponse.json(workspaces)
}
