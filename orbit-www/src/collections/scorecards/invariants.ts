import type { CollectionBeforeValidateHook } from 'payload'

type MutableDoc = Record<string, unknown>

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value)
    return String((value as { id: unknown }).id)
  return null
}

function effective(data: MutableDoc | undefined, originalDoc: unknown, field: string): unknown {
  if (data && Object.prototype.hasOwnProperty.call(data, field)) return data[field]
  return (originalDoc as MutableDoc | null | undefined)?.[field]
}

function workspaceOf(doc: unknown): string | null {
  return relationId((doc as MutableDoc | null | undefined)?.workspace)
}

export const validateRuleRelationships: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data
  const scorecardId = relationId(effective(data, originalDoc, 'scorecard'))
  const workspaceId = relationId(effective(data, originalDoc, 'workspace'))
  if (!scorecardId || !workspaceId) return data

  const scorecard = await req.payload.findByID({
    collection: 'scorecards',
    id: scorecardId,
    depth: 0,
    overrideAccess: true,
  })
  if (workspaceOf(scorecard) !== workspaceId) {
    throw new Error('A scorecard rule and its scorecard must belong to the same workspace.')
  }

  const weight = effective(data, originalDoc, 'weight')
  if (typeof weight === 'number' && (!Number.isFinite(weight) || weight < 0)) {
    throw new Error('Rule weight must be a finite, non-negative number.')
  }

  const level = effective(data, originalDoc, 'level')
  if (
    typeof level === 'string' &&
    level.trim() &&
    !(scorecard.levels ?? []).some((candidate) => candidate.name === level.trim())
  ) {
    throw new Error(`Rule level "${level}" is not defined on the parent scorecard.`)
  }

  const type = effective(data, originalDoc, 'type')
  const expression = effective(data, originalDoc, 'expression')
  if (type === 'entity-score' && expression && typeof expression === 'object') {
    const referencedScorecardId = relationId((expression as MutableDoc).scorecardId)
    if (referencedScorecardId) {
      const referenced = await req.payload.findByID({
        collection: 'scorecards',
        id: referencedScorecardId,
        depth: 0,
        overrideAccess: true,
      })
      if (workspaceOf(referenced) !== workspaceId) {
        throw new Error('An entity-score rule cannot reference a scorecard from another workspace.')
      }
    }
  }

  return data
}

export const validateInitiativeRelationships: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data
  const scorecardId = relationId(effective(data, originalDoc, 'scorecard'))
  const workspaceId = relationId(effective(data, originalDoc, 'workspace'))
  if (!scorecardId || !workspaceId) return data

  const scorecard = await req.payload.findByID({
    collection: 'scorecards',
    id: scorecardId,
    depth: 0,
    overrideAccess: true,
  })
  if (workspaceOf(scorecard) !== workspaceId) {
    throw new Error('An initiative and its scorecard must belong to the same workspace.')
  }

  const targetLevel = effective(data, originalDoc, 'targetLevel')
  if (
    typeof targetLevel === 'string' &&
    targetLevel.trim() &&
    !(scorecard.levels ?? []).some((candidate) => candidate.name === targetLevel.trim())
  ) {
    throw new Error(`Initiative target level "${targetLevel}" is not defined on the scorecard.`)
  }

  return data
}

export const validateActionItemRelationships: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data
  const workspaceId = relationId(effective(data, originalDoc, 'workspace'))
  const initiativeId = relationId(effective(data, originalDoc, 'initiative'))
  const entityId = relationId(effective(data, originalDoc, 'entity'))
  const ruleId = relationId(effective(data, originalDoc, 'rule'))
  if (!workspaceId || !initiativeId || !entityId) return data

  const [initiative, entity, rule] = await Promise.all([
    req.payload.findByID({
      collection: 'initiatives',
      id: initiativeId,
      depth: 0,
      overrideAccess: true,
    }),
    req.payload.findByID({
      collection: 'catalog-entities',
      id: entityId,
      depth: 0,
      overrideAccess: true,
    }),
    ruleId
      ? req.payload.findByID({
          collection: 'scorecard-rules',
          id: ruleId,
          depth: 0,
          overrideAccess: true,
        })
      : Promise.resolve(null),
  ])

  if (
    workspaceOf(initiative) !== workspaceId ||
    workspaceOf(entity) !== workspaceId ||
    (rule && workspaceOf(rule) !== workspaceId)
  ) {
    throw new Error('An action item and all referenced records must belong to the same workspace.')
  }
  if (rule && relationId(initiative.scorecard) !== relationId(rule.scorecard)) {
    throw new Error('An action item rule must belong to the initiative scorecard.')
  }

  if (Object.prototype.hasOwnProperty.call(data, 'assignee') && data.assignee) {
    const assigneeId = relationId(data.assignee)
    if (assigneeId) {
      const assignee = await req.payload.findByID({
        collection: 'users',
        id: assigneeId,
        depth: 0,
        overrideAccess: true,
      })
      const membership = await req.payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: assignee.betterAuthId } },
            { status: { equals: 'active' } },
          ],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (membership.docs.length === 0) {
        throw new Error('Action item assignee must be an active workspace member.')
      }
    }
  }

  return data
}
