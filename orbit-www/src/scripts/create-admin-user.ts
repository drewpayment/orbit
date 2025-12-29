/**
 * Script to create/sync a Payload user and assign super-admin role.
 *
 * Usage:
 *   cd orbit-www
 *   ENCRYPTION_KEY=... npx tsx src/scripts/create-admin-user.ts drew.payment@gmail.com
 */

import { MongoClient } from 'mongodb'

const DATABASE_URI = process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/orbit-www'

async function main() {
  const email = process.argv[2]

  if (!email) {
    console.error('Usage: npx tsx src/scripts/create-admin-user.ts <email>')
    process.exit(1)
  }

  console.log(`Creating/syncing admin user for: ${email}`)

  const client = new MongoClient(DATABASE_URI)

  try {
    await client.connect()
    const db = client.db()

    // 1. Check if Payload user exists
    let payloadUser = await db.collection('users').findOne({ email })

    if (!payloadUser) {
      // Create Payload user (minimal - no password needed since we use Better-Auth)
      const result = await db.collection('users').insertOne({
        email,
        name: email.split('@')[0],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      payloadUser = { _id: result.insertedId, email }
      console.log(`✓ Created Payload user: ${payloadUser._id}`)
    } else {
      console.log(`✓ Payload user already exists: ${payloadUser._id}`)
    }

    // 2. Check if super-admin role exists, create if not
    let superAdminRole = await db.collection('roles').findOne({ slug: 'super-admin' })

    if (!superAdminRole) {
      const result = await db.collection('roles').insertOne({
        slug: 'super-admin',
        name: 'Super Admin',
        description: 'Full platform administrator access',
        scope: 'platform',
        isSystem: true,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      superAdminRole = { _id: result.insertedId, slug: 'super-admin' }
      console.log(`✓ Created super-admin role: ${superAdminRole._id}`)
    } else {
      console.log(`✓ Super-admin role exists: ${superAdminRole._id}`)
    }

    // 3. Check if role assignment exists
    const existingAssignment = await db.collection('user-workspace-roles').findOne({
      user: payloadUser._id,
      role: superAdminRole._id,
      workspace: null,
    })

    if (!existingAssignment) {
      await db.collection('user-workspace-roles').insertOne({
        user: payloadUser._id,
        workspace: null, // null = platform-level role
        role: superAdminRole._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      console.log(`✓ Assigned super-admin role to user`)
    } else {
      console.log(`✓ User already has super-admin role`)
    }

    console.log('\n✅ Done! User now has platform admin access.')
    console.log('   Refresh http://localhost:3000/platform/kafka to test.')

  } finally {
    await client.close()
  }
}

main().catch(console.error)
