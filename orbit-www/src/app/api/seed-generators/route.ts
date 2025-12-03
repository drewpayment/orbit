import { getPayload } from 'payload'
import config from '@payload-config'
import { builtInGenerators } from '@/lib/seeds/deployment-generators'
import { NextResponse } from 'next/server'

export async function POST() {
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
