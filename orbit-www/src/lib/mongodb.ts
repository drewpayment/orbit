import { MongoClient } from 'mongodb'

if (!process.env.DATABASE_URI) {
  throw new Error('DATABASE_URI environment variable is required')
}

const client = new MongoClient(process.env.DATABASE_URI)
let connected = false

export async function getMongoClient(): Promise<MongoClient> {
  if (!connected) {
    await client.connect()
    connected = true
  }
  return client
}
