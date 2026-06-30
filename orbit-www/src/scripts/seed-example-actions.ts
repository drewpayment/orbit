// orbit-www/src/scripts/seed-example-actions.ts
//
// Idempotent (re-runnable) seed for example self-service Actions (IDP refocus
// P3). Seeds three Actions that exercise the runner's dispatch paths:
//   1. "Register a service"        — builtin/register-service, no approval.
//   2. "Provision Kafka topic …"   — kafka-provision, DEFERRED (shows the
//                                     not-yet-wired Temporal dispatch path).
//   3. "Notify webhook (example)"  — webhook, workspace-admin approval (shows
//                                     the approval gate without firing on seed).
//
// The workspace is auto-detected from the existing catalog-entities (uses the
// workspace owning the first entity found), so this rides on whatever the
// catalog backfill / projection produced. Re-running updates the existing
// Actions in place (keyed on name within the workspace) rather than duplicating.
//
// Usage:
//   NODE_OPTIONS="--conditions=react-server" bunx tsx src/scripts/seed-example-actions.ts

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Action } from '@/payload-types'

type ActionSeed = {
  name: string
  description: string
  icon: string
  approvalPolicy: NonNullable<Action['approvalPolicy']>
  backend: Action['backend']
  inputSchema: { fields: Array<Record<string, unknown>> }
}

const ACTIONS: ActionSeed[] = [
  {
    name: 'Register a service',
    description: 'Add a new service to the catalog by hand (no backing app yet).',
    icon: 'plus-circle',
    approvalPolicy: 'none',
    backend: { type: 'builtin', ref: 'register-service' },
    inputSchema: {
      fields: [
        { name: 'name', label: 'Service name', type: 'text', required: true, placeholder: 'payments-api' },
        { name: 'description', label: 'Description', type: 'textarea', placeholder: 'What does it do?' },
      ],
    },
  },
  {
    name: 'Provision Kafka topic (preview)',
    description:
      'Request a new Kafka topic. Temporal-backed dispatch is deferred — this run parks pending until the ActionDispatch workflow is wired.',
    icon: 'layers',
    approvalPolicy: 'none',
    backend: { type: 'kafka-provision', ref: 'kafka-topic' },
    inputSchema: {
      fields: [
        { name: 'topic', label: 'Topic name', type: 'text', required: true, placeholder: 'orders.events' },
        {
          name: 'partitions',
          label: 'Partitions',
          type: 'number',
          help: 'Defaults to 3 when the workflow is wired.',
        },
        {
          name: 'environment',
          label: 'Environment',
          type: 'select',
          options: ['dev', 'staging', 'prod'],
          required: true,
        },
      ],
    },
  },
  {
    name: 'Notify webhook (example)',
    description:
      'POST the run inputs to an external webhook. Gated on workspace-admin approval to demonstrate the approval flow.',
    icon: 'webhook',
    approvalPolicy: 'workspace-admin',
    backend: { type: 'webhook', ref: 'https://httpbin.org/post' },
    inputSchema: {
      fields: [
        { name: 'message', label: 'Message', type: 'text', required: true, placeholder: 'Hello from Orbit' },
      ],
    },
  },
]

async function main() {
  const payload = await getPayload({ config })

  // Auto-detect a workspace from the existing catalog.
  const entities = await payload.find({
    collection: 'catalog-entities',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const first = entities.docs[0]
  if (!first) {
    console.error(
      '[seed-actions] No catalog-entities found. Run the catalog backfill first so a workspace can be detected.',
    )
    process.exit(1)
  }
  const workspaceId = typeof first.workspace === 'string' ? first.workspace : first.workspace.id
  console.log(`[seed-actions] Seeding Actions into workspace ${workspaceId}.`)

  for (const seed of ACTIONS) {
    const existing = await payload.find({
      collection: 'actions',
      where: {
        and: [{ workspace: { equals: workspaceId } }, { name: { equals: seed.name } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const data = {
      name: seed.name,
      description: seed.description,
      workspace: workspaceId,
      icon: seed.icon,
      inputSchema: seed.inputSchema,
      approvalPolicy: seed.approvalPolicy,
      backend: seed.backend,
      enabled: true,
    }

    if (existing.docs.length > 0) {
      await payload.update({
        collection: 'actions',
        id: existing.docs[0].id,
        data,
        overrideAccess: true,
      })
      console.log(`[seed-actions] Updated "${seed.name}".`)
    } else {
      await payload.create({ collection: 'actions', data, overrideAccess: true })
      console.log(`[seed-actions] Created "${seed.name}".`)
    }
  }

  console.log('[seed-actions] Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[seed-actions] Failed:', err)
  process.exit(1)
})
