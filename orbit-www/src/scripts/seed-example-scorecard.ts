// orbit-www/src/scripts/seed-example-scorecard.ts
//
// Idempotent (re-runnable) seed for an example "Production Readiness" scorecard
// (IDP refocus P2). It targets `service` catalog entities with a three-rung
// maturity ladder (Bronze / Silver / Gold) and four rules spanning all three
// rule types. Re-running updates the existing scorecard/rules in place rather
// than duplicating them (keyed on name + title within the workspace).
//
// The workspace is auto-detected from the existing catalog-entities (uses the
// workspace owning the first entity found), so this rides on whatever the
// catalog backfill produced.
//
// Usage:
//   NODE_OPTIONS="--conditions=react-server" bunx tsx src/scripts/seed-example-scorecard.ts

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Scorecard, ScorecardRule } from '@/payload-types'

type RuleSeed = {
  title: string
  description: string
  level: string
  type: ScorecardRule['type']
  expression: Record<string, unknown>
}

const RULES: RuleSeed[] = [
  {
    title: 'Has an owning team',
    description: 'Every service must declare an owning team (catalog `owner`).',
    level: 'Bronze',
    type: 'field-presence',
    expression: { path: 'owner', op: 'exists' },
  },
  {
    title: 'Has a description',
    description: 'Service must carry a non-empty description.',
    level: 'Bronze',
    type: 'field-presence',
    expression: { path: 'description', op: 'not-empty' },
  },
  {
    title: 'Declares a dependency',
    description:
      'Service has at least one outgoing dependency edge (depends-on), evidencing it is wired into the graph.',
    level: 'Silver',
    type: 'relation-check',
    // Single-relationType per the expression contract; we score depends-on
    // (produces-topic would be a second rule if desired).
    expression: { relationType: 'depends-on', direction: 'from', min: 1 },
  },
  {
    title: 'Reports healthy',
    description: 'Service health badge is `healthy`.',
    level: 'Gold',
    type: 'threshold',
    expression: { path: 'health', op: 'eq', value: 'healthy' },
  },
]

async function seed() {
  const payload = await getPayload({ config })

  // --- find a workspace that owns catalog entities -------------------------
  const entitiesRes = await payload.find({
    collection: 'catalog-entities',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (entitiesRes.docs.length === 0) {
    console.error(
      'No catalog-entities found. Run the catalog backfill first (src/scripts/backfill-catalog-graph.ts).',
    )
    process.exit(1)
  }
  const firstEntity = entitiesRes.docs[0]
  const workspaceId =
    typeof firstEntity.workspace === 'string' ? firstEntity.workspace : firstEntity.workspace.id
  console.log(`Using workspace ${workspaceId} (from catalog-entity ${firstEntity.id}).`)

  // --- upsert the scorecard (keyed on name + workspace) --------------------
  const SCORECARD_NAME = 'Production Readiness'
  const existing = await payload.find({
    collection: 'scorecards',
    where: {
      and: [{ name: { equals: SCORECARD_NAME } }, { workspace: { equals: workspaceId } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const scorecardData = {
    name: SCORECARD_NAME,
    description: 'Baseline operational-excellence checks for services.',
    workspace: workspaceId,
    appliesTo: { kind: 'service' as const },
    levels: [
      { name: 'Bronze', rank: 1, color: '#cd7f32' },
      { name: 'Silver', rank: 2, color: '#c0c0c0' },
      { name: 'Gold', rank: 3, color: '#ffd700' },
    ],
    enabled: true,
  }

  let scorecard: Scorecard
  if (existing.docs.length > 0) {
    scorecard = (await payload.update({
      collection: 'scorecards',
      id: existing.docs[0].id,
      data: scorecardData,
      overrideAccess: true,
    })) as Scorecard
    console.log(`Updated scorecard "${SCORECARD_NAME}" (${scorecard.id}).`)
  } else {
    scorecard = (await payload.create({
      collection: 'scorecards',
      data: scorecardData,
      overrideAccess: true,
    })) as Scorecard
    console.log(`Created scorecard "${SCORECARD_NAME}" (${scorecard.id}).`)
  }

  // --- upsert each rule (keyed on scorecard + title) -----------------------
  for (const r of RULES) {
    const existingRule = await payload.find({
      collection: 'scorecard-rules',
      where: {
        and: [{ scorecard: { equals: scorecard.id } }, { title: { equals: r.title } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const ruleData = {
      scorecard: scorecard.id,
      workspace: workspaceId,
      title: r.title,
      description: r.description,
      level: r.level,
      type: r.type,
      expression: r.expression,
      weight: 1,
    }

    if (existingRule.docs.length > 0) {
      await payload.update({
        collection: 'scorecard-rules',
        id: existingRule.docs[0].id,
        data: ruleData,
        overrideAccess: true,
      })
      console.log(`  Updated rule "${r.title}" (${r.level}, ${r.type}).`)
    } else {
      await payload.create({
        collection: 'scorecard-rules',
        data: ruleData,
        overrideAccess: true,
      })
      console.log(`  Created rule "${r.title}" (${r.level}, ${r.type}).`)
    }
  }

  console.log(`\nSeed complete: scorecard "${SCORECARD_NAME}" with ${RULES.length} rules.`)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
