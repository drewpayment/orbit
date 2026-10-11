/**
 * One-off, idempotent migration: encrypt secret fields that were historically
 * stored in plaintext (cloud-accounts.credentials, llm-providers.apiKey,
 * kafka-clusters.credentials, templates/apps.webhookSecret) and re-encrypt any
 * values that only passed the old loose "has two colons" ciphertext check.
 *
 * Operates on raw MongoDB documents (bypassing Payload hooks and access), using
 * the same AES-256-GCM envelope as lib/encryption. Safe to run repeatedly:
 * values already in envelope form are left untouched. Each write is guarded by
 * the value that was read, so a concurrent change is never clobbered, and every
 * new ciphertext is decrypted and compared before it is written.
 *
 * Usage (from orbit-www/, DATABASE_URI and ENCRYPTION_KEY must be set, or be in .env):
 *   bun run secrets:encrypt:dry-run     # report only, writes nothing
 *   bun run secrets:encrypt             # apply
 * or: npx tsx src/scripts/migrate-encrypt-secrets.ts [--dry-run]
 *
 * ENCRYPTION_KEY must be the SAME key the running app uses; a different key
 * would make the migrated values undecryptable by the app.
 *
 * The report only contains counts — never secret values.
 */
import 'dotenv/config'
import { MongoClient } from 'mongodb'
import {
  encryptSecretValue,
  encryptSecretJson,
  decryptSecretString,
  decryptSecretJson,
  isEncryptedEnvelope,
  isEncryptedJson,
} from '../lib/encryption/secret-fields'

export interface SecretTarget {
  collection: string
  /** Dot path of the field inside the raw document. */
  path: string
  /**
   * 'json' fields hold an object (Payload json type) and are stored as
   * `{ enc: <envelope> }`; 'text' fields hold the envelope string itself.
   */
  kind: 'text' | 'json'
}

export const SECRET_TARGETS: SecretTarget[] = [
  { collection: 'cloud-accounts', path: 'credentials', kind: 'json' },
  { collection: 'llm-providers', path: 'apiKey', kind: 'text' },
  { collection: 'kafka-clusters', path: 'credentials', kind: 'json' },
  { collection: 'templates', path: 'webhookSecret', kind: 'text' },
  { collection: 'apps', path: 'webhookSecret', kind: 'text' },
  { collection: 'github-installations', path: 'installationToken', kind: 'text' },
  { collection: 'git-connections', path: 'credentials.pat', kind: 'text' },
  { collection: 'git-connections', path: 'credentials.clientSecret', kind: 'text' },
]

type RawDoc = Record<string, unknown> & { _id: unknown }

/** The subset of a Mongo collection the migration uses (lets tests fake it). */
export interface MigratableCollection {
  find(filter: Record<string, unknown>): { toArray(): Promise<RawDoc[]> }
  updateOne(
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown> },
  ): Promise<{ modifiedCount?: number }>
}

export interface MigrationReport {
  collection: string
  path: string
  scanned: number
  encrypted: number
  alreadyEncrypted: number
  errors: number
}

function getPath(doc: RawDoc, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], doc)
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0
}

export async function migrateTarget(
  collection: MigratableCollection,
  target: SecretTarget,
  opts: { apply: boolean },
): Promise<MigrationReport> {
  const report: MigrationReport = {
    collection: target.collection,
    path: target.path,
    scanned: 0,
    encrypted: 0,
    alreadyEncrypted: 0,
    errors: 0,
  }

  const docs = await collection.find({ [target.path]: { $exists: true, $nin: [null, ''] } }).toArray()

  for (const doc of docs) {
    const current = getPath(doc, target.path)
    if (isEmpty(current)) continue
    report.scanned++

    if (target.kind === 'json' ? isEncryptedJson(current) : isEncryptedEnvelope(current)) {
      report.alreadyEncrypted++
      continue
    }

    // A json field is expected to hold an object, or a bare envelope string
    // (earlier format) that is converted to the { enc } wrapper once it is
    // verified to decrypt to JSON. Any other string is unexpected data we
    // refuse to guess about.
    const bareEnvelope = target.kind === 'json' && isEncryptedEnvelope(current)
    if (
      target.kind === 'json' &&
      !bareEnvelope &&
      (typeof current !== 'object' || Array.isArray(current))
    ) {
      report.errors++
      continue
    }

    try {
      let next: unknown
      if (bareEnvelope) {
        next = { enc: current }
        JSON.parse(decryptSecretString(current))
      } else if (target.kind === 'json') {
        next = encryptSecretJson(current)
        const roundTrip = JSON.stringify(decryptSecretJson(next))
        if (roundTrip !== JSON.stringify(current)) throw new Error('round-trip mismatch')
      } else {
        next = encryptSecretValue(current)
        if (decryptSecretString(next) !== current) throw new Error('round-trip mismatch')
      }

      if (opts.apply) {
        const res = await collection.updateOne(
          { _id: doc._id, [target.path]: current },
          { $set: { [target.path]: next } },
        )
        if (res.modifiedCount !== 1) {
          // Changed concurrently (e.g. re-saved through the app); next run re-checks.
          report.errors++
          continue
        }
      }
      report.encrypted++
    } catch {
      report.errors++
    }
  }

  return report
}

export async function main(): Promise<void> {
  const apply = !process.argv.includes('--dry-run')
  const uri = process.env.DATABASE_URI
  if (!uri) throw new Error('DATABASE_URI is required')
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required')

  const client = new MongoClient(uri)
  await client.connect()
  let failed = false
  try {
    const db = client.db()
    for (const target of SECRET_TARGETS) {
      const report = await migrateTarget(
        db.collection(target.collection) as unknown as MigratableCollection,
        target,
        { apply },
      )
      if (report.errors > 0) failed = true
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }))
    }
  } finally {
    await client.close()
  }
  if (failed) {
    throw new Error('Some values could not be migrated (see errors > 0 above); re-run after investigating')
  }
}

if (process.argv[1]?.endsWith('migrate-encrypt-secrets.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
