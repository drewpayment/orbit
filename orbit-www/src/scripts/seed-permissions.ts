// orbit-www/src/scripts/seed-permissions.ts
//
// Standalone script to seed permissions and roles.
// Usage: cd orbit-www && npx tsx src/scripts/seed-permissions.ts
//
// The setup flow (/api/setup) also calls this automatically for the first user.

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import { seedPermissionsAndRoles } from '@/lib/seed-roles'

async function seed() {
  const payload = await getPayload({ config })

  console.log('Seeding permissions and roles...')
  const { superAdminRoleId } = await seedPermissionsAndRoles(payload)
  console.log(`Seed complete! super-admin role ID: ${superAdminRoleId}`)

  process.exit(0)
}

seed().catch(console.error)
