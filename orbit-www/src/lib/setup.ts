import { MongoClient } from 'mongodb'

// Lazy: created on first use so importing this module doesn't require DATABASE_URI.
let client: MongoClient | undefined

function getSetupClient(): MongoClient {
  if (!client) {
    if (!process.env.DATABASE_URI) {
      throw new Error('DATABASE_URI environment variable is required')
    }
    client = new MongoClient(process.env.DATABASE_URI)
  }
  return client
}

let cachedHasUsers: boolean | null = null

/**
 * Check if any users exist in Better Auth's user collection.
 * Result is cached once true (users can't be un-created).
 * False results are NOT cached so setup detection keeps checking.
 * Returns false on connection errors (safe default: show setup rather than 500).
 */
export async function hasUsers(): Promise<boolean> {
  if (cachedHasUsers === true) return true

  // Outside the try: a missing DATABASE_URI is a configuration error and should
  // surface, not be masked as "no users" like connection failures are.
  const c = getSetupClient()

  try {
    await c.connect()
    const count = await c.db().collection('user').countDocuments({}, { limit: 1 })
    const result = count > 0

    if (result) {
      cachedHasUsers = true
    }

    return result
  } catch (error) {
    console.error('[setup] Failed to check user count:', error)
    return false
  }
}

/** Invalidate the cached result. Called after setup completes. */
export function resetSetupCache(): void {
  cachedHasUsers = null
}
