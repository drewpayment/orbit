import { MongoClient } from 'mongodb'

if (!process.env.DATABASE_URI) {
  throw new Error('DATABASE_URI environment variable is required')
}

const client = new MongoClient(process.env.DATABASE_URI)

let cachedHasUsers: boolean | null = null

/**
 * Check if any users exist in Better Auth's user collection.
 * Result is cached once true (users can't be un-created).
 * False results are NOT cached so setup detection keeps checking.
 * Returns false on connection errors (safe default: show setup rather than 500).
 */
export async function hasUsers(): Promise<boolean> {
  if (cachedHasUsers === true) return true

  try {
    await client.connect()
    const count = await client.db().collection('user').countDocuments({}, { limit: 1 })
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
