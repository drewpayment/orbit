'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { createHash } from 'crypto'
import { requireActor, authorize, ALL_ROLES, MANAGE_ROLES, type Actor } from '@/lib/authz'
import type { ApiSchema as APISchema } from '@/payload-types'

// Identity always comes from the session (`requireActor`); no action accepts a
// client-supplied user id. Writes run with `overrideAccess: true` only AFTER
// `authorize()` has checked the actor against the schema's workspace (the
// collection rules are mirrored: update = creator or any member, delete =
// creator or owner/admin). Reads go through the collection access rules as the
// actor (`overrideAccess: false`) so private/workspace visibility is honoured.

const relId = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null

/** Load a schema (no access filter) so its workspace/creator can be authorized. */
async function loadSchemaForAuth(id: string, payload: Awaited<ReturnType<typeof getPayload>>) {
  const schema = (await payload.findByID({
    collection: 'api-schemas',
    id,
    depth: 0,
    overrideAccess: true,
  })) as APISchema | null
  if (!schema) throw new Error('API schema not found')
  return schema
}

function schemaResource(schema: APISchema, roles: readonly ('owner' | 'admin' | 'member')[]) {
  return {
    kind: 'doc' as const,
    workspaceId: relId(schema.workspace),
    ownerPayloadId: relId(schema.createdBy),
    roles,
  }
}

export interface CreateAPISchemaInput {
  name: string
  slug: string
  description?: string
  workspaceId: string
  visibility: 'private' | 'workspace' | 'public'
  rawContent: string
  tags?: string[]
  contactName?: string
  contactEmail?: string
}

export interface UpdateAPISchemaInput {
  id: string
  name?: string
  description?: string
  visibility?: 'private' | 'workspace' | 'public'
  rawContent?: string
  tags?: string[]
  contactName?: string
  contactEmail?: string
  status?: 'draft' | 'published' | 'deprecated'
  releaseNotes?: string
}

export async function createAPISchema(input: CreateAPISchemaInput) {
  const actor = await authorize('create', { kind: 'workspace', id: input.workspaceId })
  const payload = await getPayload({ config })

  // Create the API schema
  const schema = await payload.create({
    collection: 'api-schemas',
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description || '',
      workspace: input.workspaceId,
      visibility: input.visibility,
      schemaType: 'openapi',
      rawContent: input.rawContent,
      status: 'draft',
      tags: input.tags?.map((tag) => ({ tag })) || [],
      contactName: input.contactName || '',
      contactEmail: input.contactEmail || '',
      createdBy: actor.payloadId,
      latestVersionNumber: 1,
    },
    overrideAccess: true,
  })

  // Create the first version
  const contentHash = createHash('sha256').update(input.rawContent).digest('hex')

  await payload.create({
    collection: 'api-schema-versions',
    data: {
      schema: schema.id,
      workspace: input.workspaceId,
      version: schema.currentVersion || 'v1',
      versionNumber: 1,
      rawContent: input.rawContent,
      contentHash,
      releaseNotes: 'Initial version',
      createdBy: actor.payloadId,
    },
    overrideAccess: true,
  })

  revalidatePath(`/workspaces`)
  revalidatePath(`/catalog/apis`)

  return { success: true, schemaId: schema.id }
}

export async function updateAPISchema(input: UpdateAPISchemaInput) {
  const actor = await requireActor()
  const payload = await getPayload({ config })

  const currentSchema = await loadSchemaForAuth(input.id, payload)
  await authorize('update', schemaResource(currentSchema, ALL_ROLES), actor)

  // Check if content changed
  let newVersionNumber = currentSchema.latestVersionNumber || 1
  const contentChanged = input.rawContent && input.rawContent !== currentSchema.rawContent

  if (contentChanged && input.rawContent) {
    // Create new version
    newVersionNumber++
    const contentHash = createHash('sha256').update(input.rawContent).digest('hex')

    // Parse version from spec if possible
    let version = `v${newVersionNumber}`
    try {
      const yaml = await import('yaml')
      const spec = yaml.parse(input.rawContent)
      if (spec?.info?.version) {
        version = spec.info.version
      }
    } catch {
      // Use auto-generated version
    }

    await payload.create({
      collection: 'api-schema-versions',
      data: {
        schema: input.id,
        workspace: relId(currentSchema.workspace) as string,
        version,
        versionNumber: newVersionNumber,
        rawContent: input.rawContent,
        contentHash,
        releaseNotes: input.releaseNotes || '',
        createdBy: actor.payloadId,
      },
      overrideAccess: true,
    })
  }

  // Update the schema
  const updateData: Record<string, unknown> = {
    lastEditedBy: actor.payloadId,
  }

  if (input.name !== undefined) updateData.name = input.name
  if (input.description !== undefined) updateData.description = input.description
  if (input.visibility !== undefined) updateData.visibility = input.visibility
  if (input.rawContent !== undefined) updateData.rawContent = input.rawContent
  if (input.status !== undefined) updateData.status = input.status
  if (input.contactName !== undefined) updateData.contactName = input.contactName
  if (input.contactEmail !== undefined) updateData.contactEmail = input.contactEmail
  if (input.tags !== undefined) updateData.tags = input.tags.map((tag) => ({ tag }))
  if (contentChanged) updateData.latestVersionNumber = newVersionNumber

  await payload.update({
    collection: 'api-schemas',
    id: input.id,
    data: updateData,
    overrideAccess: true,
  })

  revalidatePath(`/workspaces`)
  revalidatePath(`/catalog/apis`)

  return { success: true, newVersion: contentChanged }
}

export async function deleteAPISchema(id: string) {
  const actor = await requireActor()
  const payload = await getPayload({ config })

  const schema = await loadSchemaForAuth(id, payload)
  await authorize('delete', schemaResource(schema, MANAGE_ROLES), actor)

  // Delete all versions first
  const versions = await payload.find({
    collection: 'api-schema-versions',
    where: { schema: { equals: id } },
    overrideAccess: true,
  })

  for (const version of versions.docs) {
    await payload.delete({
      collection: 'api-schema-versions',
      id: version.id,
      overrideAccess: true,
    })
  }

  // Delete the schema
  await payload.delete({
    collection: 'api-schemas',
    id,
    overrideAccess: true,
  })

  revalidatePath(`/workspaces`)
  revalidatePath(`/catalog/apis`)

  return { success: true }
}

export async function restoreVersion(schemaId: string, versionId: string) {
  const actor = await requireActor()
  const payload = await getPayload({ config })

  const schema = await loadSchemaForAuth(schemaId, payload)
  await authorize('update', schemaResource(schema, ALL_ROLES), actor)

  // Get the version to restore
  const version = await payload.findByID({
    collection: 'api-schema-versions',
    id: versionId,
    depth: 0,
    overrideAccess: true,
  })

  if (!version || relId(version.schema) !== schemaId) {
    throw new Error('Version not found')
  }

  // Update schema with version's content (this will trigger a new version via hook)
  await updateAPISchema({
    id: schemaId,
    rawContent: version.rawContent,
    releaseNotes: `Restored from version ${version.version}`,
  })

  return { success: true }
}

export async function getWorkspaceAPIs(workspaceId: string) {
  const actor = await authorize('read', { kind: 'workspace', id: workspaceId })
  const payload = await getPayload({ config })

  const schemas = await payload.find({
    collection: 'api-schemas',
    where: { workspace: { equals: workspaceId } },
    sort: '-updatedAt',
    user: actor.user,
    overrideAccess: false,
  })

  return schemas.docs
}

export async function getAPISchema(id: string) {
  const actor = await requireActor()
  const payload = await getPayload({ config })

  const schema = await payload.findByID({
    collection: 'api-schemas',
    id,
    depth: 2,
    user: actor.user,
    overrideAccess: false,
  })

  return schema
}

export async function deprecateAPISchema(
  id: string,
  message?: string,
): Promise<void> {
  const actor = await requireActor()
  const payload = await getPayload({ config })

  const schema = await loadSchemaForAuth(id, payload)
  await authorize('update', schemaResource(schema, ALL_ROLES), actor)

  await payload.update({
    collection: 'api-schemas',
    id,
    data: {
      status: 'deprecated',
      deprecationMessage: message || null,
    } as Record<string, unknown>,
    overrideAccess: true,
  })
}

export async function getAPISchemaVersions(schemaId: string) {
  const actor: Actor = await requireActor()
  const payload = await getPayload({ config })

  const versions = await payload.find({
    collection: 'api-schema-versions',
    where: { schema: { equals: schemaId } },
    sort: '-versionNumber',
    user: actor.user,
    overrideAccess: false,
  })

  return versions.docs
}
