// orbit-www/src/lib/scaffolder/versions.ts
import type { Payload } from 'payload'

/**
 * Versioning helpers for `template-definitions` / `template-definition-versions`
 * (phase-1 plan §2.4). `template-definition-versions` is write-closed to
 * humans (`create/update/delete: () => false`); authoring goes through these
 * helpers, which role-check in the CALLER (a server action or internal
 * route, Phase 2) and write with `overrideAccess: true`.
 */

export interface CreateDraftVersionInput {
  definitionId: string
  definitionJson: unknown
  userId: string
  changeNote?: string
}

/**
 * Creates the next version snapshot for a definition. `versionNumber` is one
 * past the current max for that definition (1 if none exist). `workspace` is
 * denormalized from the parent so `workspaceScopedRead()` works on the
 * version collection without a resolver hop through `definition`.
 *
 * Only repoints the parent's `currentVersion` pointer while the parent is
 * still `draft` — once `published`, a new draft version must go through
 * {@link publishVersion} to become current (the publish gate must not be
 * bypassable by simply creating a version).
 */
export async function createDraftVersion(payload: Payload, input: CreateDraftVersionInput) {
  const { definitionId, definitionJson, userId, changeNote } = input

  const definition = await payload.findByID({
    collection: 'template-definitions',
    id: definitionId,
    depth: 0,
    overrideAccess: true,
  })

  const existing = await payload.find({
    collection: 'template-definition-versions',
    where: { definition: { equals: definitionId } },
    sort: '-versionNumber',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const nextVersionNumber = (existing.docs[0]?.versionNumber ?? 0) + 1

  const workspaceId =
    typeof definition.workspace === 'string' ? definition.workspace : definition.workspace?.id

  const version = await payload.create({
    collection: 'template-definition-versions',
    data: {
      definition: definitionId,
      workspace: workspaceId,
      versionNumber: nextVersionNumber,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      definitionJson: definitionJson as any,
      editedBy: userId,
      changeNote,
    },
    overrideAccess: true,
  })

  if (definition.status === 'draft') {
    await payload.update({
      collection: 'template-definitions',
      id: definitionId,
      data: { currentVersion: version.id },
      overrideAccess: true,
    })
  }

  return version
}

export interface PublishVersionInput {
  definitionId: string
  versionId: string
  userId: string
}

/**
 * Enforces the publish gate (design §3.2, phase-1 plan §2.4): a version may
 * only become the definition's `currentVersion` / `published` state if BOTH
 * (a) `validatedAt` is set (static validation passed) AND (b) `dryRunRunId`
 * points at an `action-runs` row that (i) succeeded AND (ii) was itself a
 * run of THIS version — a succeeded dry run of a different, stale version
 * cannot satisfy the gate.
 */
export async function publishVersion(payload: Payload, input: PublishVersionInput) {
  const { definitionId, versionId, userId } = input
  void userId

  const version = await payload.findByID({
    collection: 'template-definition-versions',
    id: versionId,
    depth: 0,
    overrideAccess: true,
  })

  const versionDefinitionId =
    typeof version.definition === 'string' ? version.definition : version.definition?.id
  if (versionDefinitionId !== definitionId) {
    throw new Error(`Version ${versionId} does not belong to definition ${definitionId}`)
  }

  if (!version.validatedAt) {
    throw new Error('Publish gate failed: version has not passed static validation (validatedAt is unset)')
  }

  const dryRunRunId =
    typeof version.dryRunRunId === 'string' ? version.dryRunRunId : version.dryRunRunId?.id
  if (!dryRunRunId) {
    throw new Error('Publish gate failed: version has no recorded dry run (dryRunRunId is unset)')
  }

  const run = await payload.findByID({
    collection: 'action-runs',
    id: dryRunRunId,
    depth: 0,
    overrideAccess: true,
  })

  const runVersionId = typeof run.templateVersion === 'string' ? run.templateVersion : run.templateVersion?.id
  if (runVersionId !== versionId) {
    throw new Error(
      `Publish gate failed: recorded dry run ${dryRunRunId} belongs to a different version (${runVersionId})`,
    )
  }

  if (run.status !== 'succeeded') {
    throw new Error(`Publish gate failed: recorded dry run ${dryRunRunId} did not succeed (status: ${run.status})`)
  }

  return payload.update({
    collection: 'template-definitions',
    id: definitionId,
    data: { status: 'published', currentVersion: versionId },
    overrideAccess: true,
  })
}

export interface DeprecateDefinitionInput {
  definitionId: string
  userId: string
}

export async function deprecateDefinition(payload: Payload, input: DeprecateDefinitionInput) {
  const { definitionId, userId } = input
  void userId

  return payload.update({
    collection: 'template-definitions',
    id: definitionId,
    data: { status: 'deprecated' },
    overrideAccess: true,
  })
}
