export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * POST /api/internal/agent-tools/[id]/resolve
 *
 * Body shape:
 *   {
 *     approved: boolean,
 *     resolvedBy: string,           // optional (user id or "")
 *     reason?: string,              // rejection reason
 *
 *     // α — approve-with-edits. When `edited: true` and approved=true,
 *     // the route writes one or two AgentToolVersions rows (always v1
 *     // = agent_proposed snapshot of the current AgentTools row before
 *     // any edits, plus v2 = reviewer_edited if any field changed) and
 *     // patches the AgentTools row to the edited values + bumps
 *     // currentVersion. Empty edited fields mean "leave the agent's
 *     // proposal unchanged for this field."
 *     edited?: boolean,
 *     editedFields?: {
 *       name?: string,
 *       description?: string,
 *       templateKind?: 'shell' | 'http' | 'composite',
 *       templateJson?: string,
 *       inputSchemaJson?: string,
 *     },
 *   }
 *
 * Returns: { id, status, agentToolVersionId? } where agentToolVersionId
 * is the reviewer_edited row id (only when edited=true).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const approved = Boolean(body.approved)
    const payload = await getPayload({ config: configPromise })

    // For audit, always read the pre-resolve AgentTools row so the
    // version snapshot reflects exactly what the agent proposed.
    const existing = await payload.findByID({
      collection: 'agent-tools',
      id,
      overrideAccess: true,
    })

    const data: Record<string, unknown> = {
      status: approved ? 'approved' : 'rejected',
    }
    if (approved) {
      data.approvedBy = body.resolvedBy ?? null
      data.approvedAt = new Date().toISOString()
    } else {
      data.rejectionReason = body.reason ?? ''
    }

    let agentToolVersionId: string | undefined
    let editedFieldsList: string[] = []

    // α — capture the agent's original proposal as v1 on every approval
    // so we have an audit baseline. Even runs that don't get edited
    // produce a one-row version history. v2 = reviewer_edited only
    // appears when at least one field actually changed.
    if (approved) {
      const proposedVersion = await payload.create({
        collection: 'agent-tool-versions',
        data: {
          tool: existing.id,
          versionNumber: 1,
          source: 'agent_proposed',
          name: existing.name,
          description: existing.description ?? '',
          inputSchemaJson: existing.inputSchemaJson ?? '',
          templateKind: existing.templateKind,
          templateJson: existing.templateJson,
        } as any,
        overrideAccess: true,
      })

      const edits = body.editedFields ?? {}
      const want = {
        name: typeof edits.name === 'string' ? edits.name : '',
        description: typeof edits.description === 'string' ? edits.description : '',
        templateKind: typeof edits.templateKind === 'string' ? edits.templateKind : '',
        templateJson: typeof edits.templateJson === 'string' ? edits.templateJson : '',
        inputSchemaJson: typeof edits.inputSchemaJson === 'string' ? edits.inputSchemaJson : '',
      }
      const changed = (k: keyof typeof want, original: string) =>
        want[k] !== '' && want[k] !== original
      if (body.edited) {
        if (changed('name', existing.name)) editedFieldsList.push('name')
        if (changed('description', existing.description ?? '')) editedFieldsList.push('description')
        if (changed('templateKind', existing.templateKind)) editedFieldsList.push('template_kind')
        if (changed('templateJson', existing.templateJson)) editedFieldsList.push('template_json')
        if (changed('inputSchemaJson', existing.inputSchemaJson ?? '')) editedFieldsList.push('input_schema_json')
      }

      if (editedFieldsList.length > 0) {
        const editedVersion = await payload.create({
          collection: 'agent-tool-versions',
          data: {
            tool: existing.id,
            versionNumber: 2,
            source: 'reviewer_edited',
            name: changed('name', existing.name) ? want.name : existing.name,
            description: changed('description', existing.description ?? '')
              ? want.description
              : (existing.description ?? ''),
            inputSchemaJson: changed('inputSchemaJson', existing.inputSchemaJson ?? '')
              ? want.inputSchemaJson
              : (existing.inputSchemaJson ?? ''),
            templateKind: changed('templateKind', existing.templateKind)
              ? want.templateKind
              : existing.templateKind,
            templateJson: changed('templateJson', existing.templateJson) ? want.templateJson : existing.templateJson,
            editedBy: body.resolvedBy || null,
            editedFields: editedFieldsList.join(','),
          } as any,
          overrideAccess: true,
        })
        agentToolVersionId = String(editedVersion.id)

        // Patch the AgentTools row to the edited values so the agent's
        // next invocation uses the human-curated version.
        if (changed('name', existing.name)) data.name = want.name
        if (changed('description', existing.description ?? '')) data.description = want.description
        if (changed('templateKind', existing.templateKind)) data.templateKind = want.templateKind
        if (changed('templateJson', existing.templateJson)) data.templateJson = want.templateJson
        if (changed('inputSchemaJson', existing.inputSchemaJson ?? ''))
          data.inputSchemaJson = want.inputSchemaJson
        data.currentVersion = 2
      } else {
        data.currentVersion = 1
      }

      // Reference the proposed version for audit lookups even when no
      // edits happened.
      void proposedVersion
    }

    const updated = await payload.update({
      collection: 'agent-tools',
      id,
      data,
      overrideAccess: true,
    })
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      agentToolVersionId,
      editedFields: editedFieldsList,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
