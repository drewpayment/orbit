import 'dotenv/config'
import { MongoClient, type Collection, type Document } from 'mongodb'

export interface DuplicateCandidate {
  id: unknown
  evaluatedAt?: string | Date | null
  updatedAt?: string | Date | null
}

interface DuplicateGroup {
  candidates: DuplicateCandidate[]
  count: number
}

interface DedupeCollectionLike {
  aggregate(pipeline: Document[]): { toArray(): Promise<DuplicateGroup[]> }
  deleteMany(filter: Document): Promise<{ deletedCount?: number }>
}

export interface DedupeResult {
  duplicateGroups: number
  duplicatesRemoved: number
}

function timestamp(value: string | Date | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

/** Deterministically retain the newest projection, breaking ties by stable id. */
export function selectDuplicateSurvivor(candidates: DuplicateCandidate[]): DuplicateCandidate {
  if (candidates.length === 0) throw new Error('Cannot select a survivor from an empty group')
  return [...candidates].sort((left, right) => {
    const leftEvaluated = timestamp(left.evaluatedAt)
    const rightEvaluated = timestamp(right.evaluatedAt)
    if (leftEvaluated !== rightEvaluated) return rightEvaluated - leftEvaluated
    const leftUpdated = timestamp(left.updatedAt)
    const rightUpdated = timestamp(right.updatedAt)
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated
    return String(right.id).localeCompare(String(left.id))
  })[0]
}

/**
 * Find duplicate logical keys and optionally delete every deterministic loser.
 * Dry-run and apply use the same plan, making the operator command auditable.
 */
export async function dedupeCollection(
  collection: DedupeCollectionLike,
  keyFields: string[],
  apply: boolean,
): Promise<DedupeResult> {
  const groupId = Object.fromEntries(keyFields.map((field) => [field, `$${field}`]))
  const groups = await collection
    .aggregate([
      {
        $group: {
          _id: groupId,
          candidates: {
            $push: { id: '$_id', evaluatedAt: '$evaluatedAt', updatedAt: '$updatedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray()

  const loserIds: unknown[] = []
  for (const group of groups) {
    const survivor = selectDuplicateSurvivor(group.candidates)
    loserIds.push(...group.candidates.filter((candidate) => candidate !== survivor).map((candidate) => candidate.id))
  }

  if (apply && loserIds.length > 0) {
    const result = await collection.deleteMany({ _id: { $in: loserIds } })
    if (typeof result.deletedCount === 'number' && result.deletedCount !== loserIds.length) {
      throw new Error(`Expected to delete ${loserIds.length} duplicates, deleted ${result.deletedCount}`)
    }
  }

  return { duplicateGroups: groups.length, duplicatesRemoved: loserIds.length }
}

const TARGETS = [
  { collection: 'scorecard-rule-results', keyFields: ['scorecard', 'rule', 'entity'] },
  { collection: 'entity-scores', keyFields: ['entity', 'scope', 'scorecard'] },
  { collection: 'initiative-action-items', keyFields: ['initiative', 'entity', 'rule'] },
] as const

export async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const uri = process.env.DATABASE_URI
  if (!uri) throw new Error('DATABASE_URI is required')

  const client = new MongoClient(uri)
  await client.connect()
  try {
    const db = client.db()
    for (const target of TARGETS) {
      const collection = db.collection(target.collection) as Collection<Document>
      const result = await dedupeCollection(collection, [...target.keyFields], apply)
      console.log(
        JSON.stringify({ collection: target.collection, mode: apply ? 'apply' : 'dry-run', ...result }),
      )
      if (apply) {
        const verification = await dedupeCollection(collection, [...target.keyFields], false)
        if (verification.duplicateGroups > 0) {
          throw new Error(`${target.collection} still contains duplicate logical keys`)
        }
      }
    }
  } finally {
    await client.close()
  }
}

if (process.argv[1]?.endsWith('dedupe-scorecard-projections.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
