export const dynamic = 'force-dynamic'

import { getPayload } from 'payload'
import config from '@payload-config'
import { builtInGenerators } from '@/lib/seeds/deployment-generators'
import { NextResponse } from 'next/server'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

export async function POST() {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isPlatformAdmin(payloadUser)) {
    return NextResponse.json({ error: 'Forbidden: platform admin required' }, { status: 403 })
  }

  const payload = await getPayload({ config })

  try {
    // Check if generators already exist
    const existing = await payload.find({
      collection: 'deployment-generators',
      where: { isBuiltIn: { equals: true } },
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return NextResponse.json({
        message: 'Generators already seeded',
        count: existing.docs.length,
      })
    }

    // Seed generators
    for (const generator of builtInGenerators) {
      await payload.create({
        collection: 'deployment-generators',
        data: {
          name: generator.name,
          slug: generator.slug,
          description: generator.description,
          type: generator.type,
          isBuiltIn: generator.isBuiltIn,
          configSchema: generator.configSchema,
          templateFiles: generator.templateFiles,
        },
        overrideAccess: true,
      })
    }

    return NextResponse.json({
      message: 'Generators seeded successfully',
      count: builtInGenerators.length,
    })
  } catch (error) {
    console.error('Seed failed:', error)
    return NextResponse.json({ error: 'Failed to seed generators' }, { status: 500 })
  }
}
