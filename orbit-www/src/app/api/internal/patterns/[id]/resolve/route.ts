export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { Pattern } from '@/payload-types'

type TemplateKind = Pattern['templateKind']
const TEMPLATE_KINDS: readonly TemplateKind[] = ['shell', 'http', 'composite'] as const
const isTemplateKind = (v: unknown): v is TemplateKind =>
  typeof v === 'string' && (TEMPLATE_KINDS as readonly string[]).includes(v)

type Category = Pattern['category']
const CATEGORIES: readonly Category[] = [
  'compute',
  'data',
  'cache',
  'queue',
  'observability',
  'edge',
  'static-site',
  'other',
] as const
const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * POST /api/internal/patterns/[id]/resolve
 *
 * Body shape:
 *   {
 *     approved: boolean,
 *     resolvedBy: string,
 *     reason?: string,
 *
 *     // Approve-with-edits. When `edited: true` and approved=true, the
 *     // route writes one or two PatternVersions rows (always v1 =
 *     // agent_proposed snapshot of the current Patterns row before any
 *     // edits, plus v2 = reviewer_edited if any field changed) and
 *     // patches the Patterns row to the edited values + bumps
 *     // currentVersion. Empty edited fields mean "leave the agent's
 *     // proposal unchanged for this field."
 *     edited?: boolean,
 *     editedFields?: {
 *       name?: string,
 *       displayName?: string,
 *       description?: string,
 *       category?: 'compute' | 'data' | 'cache' | 'queue' | 'observability' | 'edge' | 'static-site' | 'other',
 *       templateKind?: 'shell' | 'http' | 'composite',
 *       templateJson?: string,
 *       inputSchemaJson?: string,
 *     },
 *   }
 *
 * Returns: { id, status, patternVersionId?, editedFields } where
 * patternVersionId is the reviewer_edited row id (only when edited=true).
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

    // Always read the pre-resolve Patterns row so v1 reflects what the
    // agent originally proposed.
    const existing = await payload.findByID({
      collection: 'patterns',
      id,
      overrideAccess: true,
    })

    const data: Partial<Pattern> = {
      status: approved ? 'approved' : 'rejected',
    }
    if (approved) {
      data.approvedBy = body.resolvedBy ?? null
      data.approvedAt = new Date().toISOString()
    } else {
      data.rejectionReason = body.reason ?? ''
    }

    let patternVersionId: string | undefined
    const editedFieldsList: string[] = []

    if (approved) {
      // v1: snapshot the agent's original proposal for audit. Written on
      // every approval, even ones without edits, so we always have an
      // unedited baseline.
      const proposedVersion = await payload.create({
        collection: 'pattern-versions',
        data: {
          pattern: existing.id,
          versionNumber: 1,
          source: 'agent_proposed',
          name: existing.name,
          patternDisplayName: existing.displayName,
          description: existing.description ?? '',
          category: existing.category,
          templateKind: existing.templateKind,
          templateJson: existing.templateJson,
          inputSchemaJson: existing.inputSchemaJson,
        },
        overrideAccess: true,
      })

      const edits = body.editedFields ?? {}
      const want = {
        name: typeof edits.name === 'string' ? edits.name : '',
        displayName: typeof edits.displayName === 'string' ? edits.displayName : '',
        description: typeof edits.description === 'string' ? edits.description : '',
        category: isCategory(edits.category) ? edits.category : undefined,
        templateKind: isTemplateKind(edits.templateKind) ? edits.templateKind : undefined,
        templateJson: typeof edits.templateJson === 'string' ? edits.templateJson : '',
        inputSchemaJson: typeof edits.inputSchemaJson === 'string' ? edits.inputSchemaJson : '',
      }
      const changedString = (
        k: 'name' | 'displayName' | 'description' | 'templateJson' | 'inputSchemaJson',
        original: string,
      ) => want[k] !== '' && want[k] !== original
      const changedCategory = (original: Category) =>
        want.category !== undefined && want.category !== original
      const changedTemplateKind = (original: TemplateKind) =>
        want.templateKind !== undefined && want.templateKind !== original

      if (body.edited) {
        if (changedString('name', existing.name)) editedFieldsList.push('name')
        if (changedString('displayName', existing.displayName)) editedFieldsList.push('display_name')
        if (changedString('description', existing.description ?? '')) editedFieldsList.push('description')
        if (changedCategory(existing.category)) editedFieldsList.push('category')
        if (changedTemplateKind(existing.templateKind)) editedFieldsList.push('template_kind')
        if (changedString('templateJson', existing.templateJson)) editedFieldsList.push('template_json')
        if (changedString('inputSchemaJson', existing.inputSchemaJson))
          editedFieldsList.push('input_schema_json')
      }

      if (editedFieldsList.length > 0) {
        const editedCategory =
          want.category !== undefined && changedCategory(existing.category)
            ? want.category
            : existing.category
        const editedTemplateKind =
          want.templateKind !== undefined && changedTemplateKind(existing.templateKind)
            ? want.templateKind
            : existing.templateKind
        const editedVersion = await payload.create({
          collection: 'pattern-versions',
          data: {
            pattern: existing.id,
            versionNumber: 2,
            source: 'reviewer_edited',
            name: changedString('name', existing.name) ? want.name : existing.name,
            patternDisplayName: changedString('displayName', existing.displayName)
              ? want.displayName
              : existing.displayName,
            description: changedString('description', existing.description ?? '')
              ? want.description
              : (existing.description ?? ''),
            category: editedCategory,
            inputSchemaJson: changedString('inputSchemaJson', existing.inputSchemaJson)
              ? want.inputSchemaJson
              : existing.inputSchemaJson,
            templateKind: editedTemplateKind,
            templateJson: changedString('templateJson', existing.templateJson)
              ? want.templateJson
              : existing.templateJson,
            editedBy: body.resolvedBy || null,
            editedFields: editedFieldsList.join(','),
          },
          overrideAccess: true,
        })
        patternVersionId = String(editedVersion.id)

        // Patch the Patterns row so future instantiations use the edited
        // values.
        if (changedString('name', existing.name)) data.name = want.name
        if (changedString('displayName', existing.displayName)) data.displayName = want.displayName
        if (changedString('description', existing.description ?? '')) data.description = want.description
        if (changedCategory(existing.category) && want.category !== undefined)
          data.category = want.category
        if (changedTemplateKind(existing.templateKind) && want.templateKind !== undefined)
          data.templateKind = want.templateKind
        if (changedString('templateJson', existing.templateJson)) data.templateJson = want.templateJson
        if (changedString('inputSchemaJson', existing.inputSchemaJson))
          data.inputSchemaJson = want.inputSchemaJson
        data.currentVersion = 2
      } else {
        data.currentVersion = 1
      }

      void proposedVersion
    }

    const updated = await payload.update({
      collection: 'patterns',
      id,
      data,
      overrideAccess: true,
    })
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      patternVersionId,
      editedFields: editedFieldsList,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
