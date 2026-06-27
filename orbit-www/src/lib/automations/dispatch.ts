import 'server-only'
import type { Payload } from 'payload'
import type { Action, Automation } from '@/payload-types'
import { createAndDispatchRun } from '@/lib/actions/create-run'
import { eventMatchesAutomation, type MatchableAutomation } from './match'
import { resolveInputMapping } from './input-mapping'
import type { AutomationEvent } from './events'

/**
 * Automation dispatcher (IDP refocus P4).
 *
 * {@link dispatchAutomationEvent} is the single entry point the event-emission
 * hooks (and the deferred schedule worker) call. It loads the enabled
 * automations in the event's workspace whose trigger event matches, filters them
 * in-process with {@link eventMatchesAutomation}, resolves each one's
 * inputMapping against the event, and creates an action-run with
 * `trigger: 'automation'` via the shared {@link createAndDispatchRun}.
 *
 * Fire-and-forget by design: each automation is dispatched independently inside
 * its own try/catch, so one bad mapping never blocks the others, and a dispatch
 * failure never propagates back to the originating save (the hooks call this
 * without awaiting the result on the critical path).
 */

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Project an Automation doc to the matcher's minimal shape. */
function toMatchable(a: Automation): MatchableAutomation {
  return {
    id: a.id,
    enabled: a.enabled,
    trigger: { event: a.trigger?.event ?? null, filter: a.trigger?.filter },
  }
}

export interface DispatchResult {
  matched: number
  dispatched: number
}

export async function dispatchAutomationEvent(
  payload: Payload,
  event: AutomationEvent,
): Promise<DispatchResult> {
  // Candidate automations: enabled, same workspace, same trigger event. The
  // fine-grained filter is applied in-process (we don't push JSON predicates to
  // Mongo).
  const res = await payload.find({
    collection: 'automations',
    where: {
      and: [
        { workspace: { equals: event.workspace } },
        { enabled: { equals: true } },
        { 'trigger.event': { equals: event.type } },
      ],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  const matched = (res.docs as Automation[]).filter((a) =>
    eventMatchesAutomation(event, toMatchable(a)),
  )

  let dispatched = 0
  for (const automation of matched) {
    try {
      const actionId = relId(automation.action)
      if (!actionId) continue

      const action = (await payload.findByID({
        collection: 'actions',
        id: actionId,
        depth: 0,
        overrideAccess: true,
      })) as Action
      if (action.enabled === false) continue

      const inputs = resolveInputMapping(automation.inputMapping, event)
      const entityId = 'entity' in event ? event.entity.id : undefined

      await createAndDispatchRun(payload, {
        action,
        inputs,
        trigger: 'automation',
        triggeredBy: null,
        entityId,
        origin: automation.name,
      })

      await payload.update({
        collection: 'automations',
        id: automation.id,
        data: { lastTriggeredAt: new Date().toISOString() },
        overrideAccess: true,
      })

      dispatched++
    } catch (err) {
      // Per-automation isolation: log and continue.
      console.error(
        `[automations] dispatch failed for automation ${automation.id} on ${event.type}:`,
        (err as Error).message,
      )
    }
  }

  return { matched: matched.length, dispatched }
}
