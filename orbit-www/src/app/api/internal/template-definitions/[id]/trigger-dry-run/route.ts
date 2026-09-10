export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { Payload } from 'payload'
import type { Action, TemplateDefinition } from '@/payload-types'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * POST /api/internal/template-definitions/[id]/trigger-dry-run
 *
 * Lets the Go worker's `TemplateDryRunSweepWorkflow` (Phase 4 Task G)
 * create-and-dispatch one dry run the same way
 * `self-service/templates/authoring-actions.ts#createAndDispatchDryRun` does
 * for a human "Preview" click: find-or-create the hidden scaffolder runner
 * Action, create a `dryRun: true` `action-runs` row, and stamp
 * `lastDryRunAt`. Unlike the human flow, this route does NOT itself dispatch
 * the run to Temporal — the caller (the sweep's `TriggerTemplateDryRun`
 * activity) starts `ScaffolderWorkflow` directly with `Trigger:
 * "scheduled-sweep"` set, which is what lets `ScaffolderWorkflow.finish()`
 * tell a sweep-triggered dry run apart from a manual "Preview" (see
 * `lastDryRunStatus`'s docblock on `TemplateDefinitions.ts`). The response
 * carries the resolved version's `definitionJson` so the worker needs no
 * second call to resolve it.
 *
 * Same X-API-Key auth model as every other `/api/internal/**` route.
 *
 * Body: `{ templateVersionId: string, parameters?: object, trigger?: string }`.
 * `trigger` defaults to `'scheduled-sweep'` (this route's only caller today)
 * but is accepted explicitly so a future caller cannot be mistaken for one.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const templateVersionId = body.templateVersionId
  if (typeof templateVersionId !== 'string' || !templateVersionId) {
    return NextResponse.json({ error: 'templateVersionId is required' }, { status: 400 })
  }
  const parameters =
    body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
      ? (body.parameters as Record<string, unknown>)
      : {}
  const requestedTrigger = typeof body.trigger === 'string' ? body.trigger : ''
  const trigger: 'manual' | 'automation' | 'scheduled-sweep' =
    requestedTrigger === 'manual' || requestedTrigger === 'automation' || requestedTrigger === 'scheduled-sweep'
      ? requestedTrigger
      : 'scheduled-sweep'

  const payload = await getPayload({ config: configPromise })

  let definition: TemplateDefinition
  try {
    definition = await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return NextResponse.json({ error: 'template definition not found' }, { status: 404 })
  }

  if (definition.status !== 'published') {
    return NextResponse.json(
      { error: `template definition "${definition.name}" is not published (status: ${definition.status})` },
      { status: 400 },
    )
  }

  let version: { id: string; definition: unknown; definitionJson: unknown }
  try {
    version = await payload.findByID({
      collection: 'template-definition-versions',
      id: templateVersionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return NextResponse.json({ error: 'template version not found' }, { status: 404 })
  }

  const versionDefinitionId =
    typeof version.definition === 'string' ? version.definition : (version.definition as { id?: string })?.id
  if (versionDefinitionId !== id) {
    return NextResponse.json(
      { error: `template version ${templateVersionId} does not belong to definition ${id}` },
      { status: 400 },
    )
  }

  const workspaceId =
    typeof definition.workspace === 'string' ? definition.workspace : definition.workspace?.id
  if (!workspaceId) {
    return NextResponse.json({ error: 'template definition has no workspace' }, { status: 400 })
  }

  const action = await ensureRunnerAction(payload, definition)

  const run = await payload.create({
    collection: 'action-runs',
    data: {
      action: action.id,
      workspace: workspaceId,
      templateVersion: templateVersionId,
      dryRun: true,
      inputs: parameters,
      status: 'pending',
      trigger,
      logs: [
        {
          ts: new Date().toISOString(),
          level: 'info',
          message: 'Dry run created by the scheduled re-dry-run sweep.',
        },
      ],
    },
    overrideAccess: true,
  })

  await payload.update({
    collection: 'template-definitions',
    id,
    data: { lastDryRunAt: new Date().toISOString() },
    overrideAccess: true,
  })

  return NextResponse.json({
    runId: run.id,
    workspaceId,
    definitionJson: version.definitionJson,
  })
}

/** Mirrors `authoring-actions.ts#ensureRunnerAction` — kept local rather than
 * imported since that module is `'use server'`-only and actively edited by
 * other in-flight work; the logic is small enough to duplicate safely. */
async function ensureRunnerAction(payload: Payload, definition: TemplateDefinition): Promise<Action> {
  const existing = await payload.find({
    collection: 'actions',
    where: {
      and: [
        { 'backend.type': { equals: 'scaffolder' } },
        { 'backend.ref': { equals: definition.id } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0]

  const workspaceId =
    typeof definition.workspace === 'string' ? definition.workspace : (definition.workspace?.id ?? '')

  return payload.create({
    collection: 'actions',
    data: {
      name: `Template: ${definition.name}`,
      description: 'Auto-provisioned runner for a v2 template-definition. Not user-editable.',
      workspace: workspaceId,
      backend: { type: 'scaffolder', ref: definition.id },
      approvalPolicy: 'none',
      enabled: true,
    },
    overrideAccess: true,
  })
}
