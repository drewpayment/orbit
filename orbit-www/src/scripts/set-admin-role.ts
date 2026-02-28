import { MongoClient } from 'mongodb'

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx src/scripts/set-admin-role.ts <email>')
    process.exit(1)
  }

  const client = new MongoClient(process.env.DATABASE_URI || 'mongodb://localhost:27017/orbit-www')
  await client.connect()
  const db = client.db()

  // Update Better Auth user
  const baResult = await db.collection('user').updateOne(
    { email },
    { $set: { role: 'super_admin' } },
  )
  console.log(`Better Auth user: ${baResult.modifiedCount ? 'updated' : 'not found'}`)

  // Update Payload user
  const plResult = await db.collection('users').updateOne(
    { email },
    { $set: { role: 'super_admin' } },
  )
  console.log(`Payload user: ${plResult.modifiedCount ? 'updated' : 'not found'}`)

  await client.close()
  console.log(`Done. ${email} is now super_admin.`)
}

main().catch(console.error)
