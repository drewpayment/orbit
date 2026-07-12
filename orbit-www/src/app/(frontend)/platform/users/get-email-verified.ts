import 'server-only'

import { getMongoClient } from '@/lib/mongodb'

/**
 * Read-only join into the Better-Auth `user` collection to fetch `emailVerified`
 * per email. The Payload `users` doc has no emailVerified field — verification
 * lives on the Better-Auth mirror in the same Mongo DB (same pattern as
 * userApprovalHook, kept strictly read-only and server-side).
 *
 * Returns a Map keyed by lowercased email → verified boolean. Emails with no
 * Better-Auth row are absent from the map (caller treats absent as unverified).
 */
export async function getEmailVerifiedMap(emails: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>()
  if (emails.length === 0) return result

  const normalized = Array.from(new Set(emails.map((e) => e.toLowerCase())))
  const db = (await getMongoClient()).db()
  const rows = await db
    .collection('user')
    .find({ email: { $in: normalized } }, { projection: { email: 1, emailVerified: 1 } })
    .toArray()

  for (const row of rows) {
    if (typeof row.email === 'string') {
      result.set(row.email.toLowerCase(), Boolean(row.emailVerified))
    }
  }
  return result
}
