// orbit-www/src/scripts/assign-super-admin.ts
//
// One-off script to seed roles and assign super-admin to an existing user.
// Usage: cd orbit-www && npx tsx src/scripts/assign-super-admin.ts <email>
//
// Example: npx tsx src/scripts/assign-super-admin.ts drew@example.com

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import { seedPermissionsAndRoles, assignSuperAdmin } from '@/lib/seed-roles'

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx src/scripts/assign-super-admin.ts <email>')
    process.exit(1)
  }

  const payload = await getPayload({ config })

  // Seed permissions and roles (idempotent)
  console.log('Seeding permissions and roles...')
  const { superAdminRoleId } = await seedPermissionsAndRoles(payload)
  console.log(`super-admin role ID: ${superAdminRoleId}`)

  // Find user by email
  const users = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })

  if (users.docs.length === 0) {
    console.error(`No user found with email: ${email}`)
    process.exit(1)
  }

  const user = users.docs[0]
  console.log(`Found user: ${user.name || user.email} (ID: ${user.id})`)

  // Assign super-admin
  await assignSuperAdmin(payload, String(user.id), superAdminRoleId)
  console.log(`Assigned super-admin role to ${email}`)

  process.exit(0)
}

main().catch(console.error)
