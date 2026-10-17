import { MongoClient } from 'mongodb'

// Lazy: the client is created on first use, not at import time, so importing this
// module (e.g. in unit tests that never touch the DB) doesn't require DATABASE_URI.
let client: MongoClient | undefined
let connected = false

function getMongoDbClient(): MongoClient {
  if (!client) {
    if (!process.env.DATABASE_URI) {
      throw new Error('DATABASE_URI environment variable is required')
    }
    client = new MongoClient(process.env.DATABASE_URI)
  }
  return client
}

export async function getMongoClient(): Promise<MongoClient> {
  const c = getMongoDbClient()
  if (!connected) {
    await c.connect()
    connected = true
  }
  return c
}
