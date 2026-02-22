'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { createHash } from 'crypto'

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
  userId: string
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
  userId: string
}

export async function createAPISchema(input: CreateAPISchemaInput) {
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
      createdBy: input.userId,
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
      createdBy: input.userId,
    },
    overrideAccess: true,
  })

  revalidatePath(`/workspaces`)
  revalidatePath(`/catalog/apis`)

  return { success: true, schemaId: schema.id }
}

export async function updateAPISchema(input: UpdateAPISchemaInput) {
  const payload = await getPayload({ config })

  // Get current schema
  const currentSchema = await payload.findByID({
    collection: 'api-schemas',
    id: input.id,
    overrideAccess: true,
  })

  if (!currentSchema) {
    throw new Error('API schema not found')
  }

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
        workspace: typeof currentSchema.workspace === 'string'
          ? currentSchema.workspace
          : currentSchema.workspace.id,
        version,
        versionNumber: newVersionNumber,
        rawContent: input.rawContent,
        contentHash,
        releaseNotes: input.releaseNotes || '',
        createdBy: input.userId,
      },
      overrideAccess: true,
    })
  }

  // Update the schema
  const updateData: Record<string, unknown> = {
    lastEditedBy: input.userId,
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
  const payload = await getPayload({ config })

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

export async function restoreVersion(schemaId: string, versionId: string, userId: string) {
  const payload = await getPayload({ config })

  // Get the version to restore
  const version = await payload.findByID({
    collection: 'api-schema-versions',
    id: versionId,
    overrideAccess: true,
  })

  if (!version) {
    throw new Error('Version not found')
  }

  // Update schema with version's content (this will trigger a new version via hook)
  await updateAPISchema({
    id: schemaId,
    rawContent: version.rawContent,
    releaseNotes: `Restored from version ${version.version}`,
    userId,
  })

  return { success: true }
}

export async function getWorkspaceAPIs(workspaceId: string) {
  const payload = await getPayload({ config })

  const schemas = await payload.find({
    collection: 'api-schemas',
    where: { workspace: { equals: workspaceId } },
    sort: '-updatedAt',
    overrideAccess: true,
  })

  return schemas.docs
}

export async function getAPISchema(id: string) {
  const payload = await getPayload({ config })

  const schema = await payload.findByID({
    collection: 'api-schemas',
    id,
    depth: 2,
    overrideAccess: true,
  })

  return schema
}

export async function deprecateAPISchema(
  id: string,
  message?: string,
): Promise<void> {
  const payload = await getPayload({ config })

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
  const payload = await getPayload({ config })

  const versions = await payload.find({
    collection: 'api-schema-versions',
    where: { schema: { equals: schemaId } },
    sort: '-versionNumber',
    overrideAccess: true,
  })

  return versions.docs
}
