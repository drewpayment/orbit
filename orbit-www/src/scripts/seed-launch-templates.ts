#!/usr/bin/env tsx

/**
 * Seed Script for Launch Templates
 *
 * Usage: tsx src/scripts/seed-launch-templates.ts
 */

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import { launchTemplatesSeedData, seedLaunchTemplates } from '../seed/launch-templates-seed'

async function seed() {
  console.log('Starting launch templates seed...\n')

  try {
    const payload = await getPayload({ config })

    console.log('Payload initialized\n')

    await seedLaunchTemplates(payload)

    const bundles = launchTemplatesSeedData.filter((t) => t.type === 'bundle')
    const resources = launchTemplatesSeedData.filter((t) => t.type === 'resource')

    console.log(`\nSummary:`)
    console.log(`  Total templates: ${launchTemplatesSeedData.length}`)
    console.log(`  Bundles: ${bundles.length}`)
    console.log(`  Resources: ${resources.length}`)

    process.exit(0)
  } catch (error) {
    console.error('Seed failed:', error)
    process.exit(1)
  }
}

seed()
