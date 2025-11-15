import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function GET() {
  const payload = await getPayload({ config: configPromise })

  const installations = await payload.find({
    collection: 'github-installations',
    sort: '-installedAt',
  })

  return NextResponse.json(installations)
}
