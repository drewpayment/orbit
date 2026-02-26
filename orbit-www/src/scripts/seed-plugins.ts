#!/usr/bin/env tsx

/**
 * Seed Script for Plugin Registry
 *
 * Usage: tsx src/scripts/seed-plugins.ts
 */

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import { pluginsSeedData } from '../seed/plugins-seed'

async function seed() {
  console.log('🌱 Starting plugin registry seed...\n')

  try {
    const payload = await getPayload({ config })

    console.log('✅ Payload initialized\n')

    for (const pluginData of pluginsSeedData) {
      try {
        // Check if plugin already exists
        const existing = await payload.find({
          collection: 'plugin-registry',
          where: {
            pluginId: {
              equals: pluginData.pluginId,
            },
          },
        })

        if (existing.docs.length > 0) {
          console.log(`📝 Plugin "${pluginData.name}" already exists, updating...`)
          await payload.update({
            collection: 'plugin-registry',
            id: existing.docs[0].id,
            data: pluginData,
          })
          console.log(`   ✅ Updated\n`)
        } else {
          console.log(`🆕 Creating plugin "${pluginData.name}"...`)
          await payload.create({
            collection: 'plugin-registry',
            data: pluginData,
          })
          console.log(`   ✅ Created\n`)
        }
      } catch (error) {
        console.error(`❌ Error seeding plugin "${pluginData.name}":`, error)
      }
    }

    console.log('🎉 Plugin registry seeding complete!')
    console.log(`\n📊 Summary:`)
    console.log(`   - Total plugins: ${pluginsSeedData.length}`)
    console.log(`   - Catalog: 1`)
    console.log(`   - GitHub Actions: 1`)
    console.log(`   - ArgoCD: 1`)

    process.exit(0)
  } catch (error) {
    console.error('❌ Seed failed:', error)
    process.exit(1)
  }
}

seed()
