/**
 * Script to create/sync a Payload user and make it a platform super_admin.
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

    // 2. Platform admin is the `users.role` field (authz consolidation Phase B
    //    removed the roles / user-workspace-roles collections).
    if (payloadUser.role === 'super_admin') {
      console.log('✓ User already has role super_admin')
    } else {
      await db.collection('users').updateOne(
        { _id: payloadUser._id },
        { $set: { role: 'super_admin', status: 'approved', updatedAt: new Date() } },
      )
      console.log('✓ Set users.role = super_admin')
    }

    console.log('\n✅ Done! User now has platform admin access.')
    console.log('   Refresh http://localhost:3000/platform/kafka to test.')

  } finally {
    await client.close()
  }
}

main().catch(console.error)
