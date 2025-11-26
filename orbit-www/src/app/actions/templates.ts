// orbit-www/src/app/actions/templates.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { parseManifest } from '@/lib/template-manifest'
import { parseGitHubUrl, fetchRepoInfo, fetchManifestContent, generateWebhookSecret, fileExists } from '@/lib/github-manifest'
import { revalidatePath } from 'next/cache'
import { Octokit } from '@octokit/rest'
import { decrypt } from '@/lib/encryption'

// Valid category values that match the Templates collection
const VALID_CATEGORIES = [
  'api-service',
  'frontend-app',
  'backend-service',
  'cli-tool',
  'library',
  'mobile-app',
  'infrastructure',
  'documentation',
  'monorepo',
] as const

type CategoryValue = (typeof VALID_CATEGORIES)[number]

/**
 * Filter and validate categories from manifest
 */
function filterValidCategories(categories?: string[]): CategoryValue[] {
  if (!categories) return []
  return categories.filter((c): c is CategoryValue =>
    VALID_CATEGORIES.includes(c as CategoryValue)
  )
}

export interface CheckManifestResult {
  exists: boolean
  repoInfo?: {
    owner: string
    repo: string
    defaultBranch: string
    description: string | null
    isTemplate: boolean
  }
  error?: string
}

/**
 * Check if a manifest exists in the repository
 */
export async function checkManifestExists(
  repoUrl: string,
  workspaceId: string,
  manifestPath?: string
): Promise<CheckManifestResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { exists: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Parse GitHub URL
  const parsed = parseGitHubUrl(repoUrl)
  if (!parsed) {
    return { exists: false, error: 'Invalid GitHub URL' }
  }

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { exists: false, error: 'Not a member of this workspace' }
  }

  // Get GitHub installation token for this workspace
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    return { exists: false, error: 'No GitHub App installation found for this workspace' }
  }

  // Get decrypted token
  const accessToken = decrypt(installation.docs[0].installationToken as string)
  if (!accessToken) {
    return { exists: false, error: 'GitHub access token not available' }
  }

  // Fetch repo info
  const repoInfo = await fetchRepoInfo(repoUrl, accessToken)
  if (!repoInfo) {
    return { exists: false, error: 'Could not access repository. Check permissions.' }
  }

  // Check if manifest file exists
  const path = manifestPath || 'orbit-template.yaml'
  const exists = await fileExists(
    repoInfo.owner,
    repoInfo.repo,
    repoInfo.defaultBranch,
    path,
    accessToken
  )

  return {
    exists,
    repoInfo,
  }
}

/**
 * Commit a manifest file to a GitHub repository
 */
export async function commitManifestToRepo(input: {
  repoUrl: string
  workspaceId: string
  manifestContent: string
  manifestPath?: string
  commitMessage?: string
}): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Parse GitHub URL
  const parsed = parseGitHubUrl(input.repoUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid GitHub URL' }
  }

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Get GitHub installation token for this workspace
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: input.workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    return { success: false, error: 'No GitHub App installation found for this workspace' }
  }

  // Get decrypted token
  const accessToken = decrypt(installation.docs[0].installationToken as string)
  if (!accessToken) {
    return { success: false, error: 'GitHub access token not available' }
  }

  // Fetch repo info to get default branch
  const repoInfo = await fetchRepoInfo(input.repoUrl, accessToken)
  if (!repoInfo) {
    return { success: false, error: 'Could not access repository. Check permissions.' }
  }

  // Create or update file using Octokit
  const octokit = new Octokit({ auth: accessToken })
  const path = input.manifestPath || 'orbit-template.yaml'

  try {
    // Check if file exists to get its SHA (needed for updates)
    let sha: string | undefined
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner: parsed.owner,
        repo: parsed.repo,
        path,
        ref: repoInfo.defaultBranch,
      })
      if ('sha' in existingFile) {
        sha = existingFile.sha
      }
    } catch {
      // File doesn't exist, which is fine
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: parsed.owner,
      repo: parsed.repo,
      path,
      message: input.commitMessage || 'Add orbit-template.yaml manifest',
      content: Buffer.from(input.manifestContent).toString('base64'),
      branch: repoInfo.defaultBranch,
      sha, // Include SHA if file exists
    })

    return { success: true }
  } catch (error: unknown) {
    console.error('[commitManifestToRepo] Error committing file:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Failed to commit manifest: ${errorMessage}` }
  }
}

export interface ImportTemplateInput {
  repoUrl: string
  workspaceId: string
  manifestPath?: string
}

export interface ImportTemplateResult {
  success: boolean
  templateId?: string
  error?: string
  warnings?: string[]
}

/**
 * Import a GitHub repository as a template
 */
export async function importTemplate(input: ImportTemplateInput): Promise<ImportTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const warnings: string[] = []

  // Parse GitHub URL
  const parsed = parseGitHubUrl(input.repoUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid GitHub URL' }
  }

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Get GitHub installation token for this workspace
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: input.workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    return { success: false, error: 'No GitHub App installation found for this workspace' }
  }

  // Get decrypted token (simplified - actual implementation uses encryption service)
  const accessToken = decrypt(installation.docs[0].installationToken as string)
  if (!accessToken) {
    return { success: false, error: 'GitHub access token not available' }
  }

  // Fetch repo info
  const repoInfo = await fetchRepoInfo(input.repoUrl, accessToken)
  if (!repoInfo) {
    return { success: false, error: 'Could not access repository. Check permissions.' }
  }

  // Warn if not a GitHub Template
  if (!repoInfo.isTemplate) {
    warnings.push('Repository is not marked as a GitHub Template. Using clone fallback for instantiation.')
  }

  // Fetch manifest
  const manifestPath = input.manifestPath || 'orbit-template.yaml'
  const manifestContent = await fetchManifestContent(
    repoInfo.owner,
    repoInfo.repo,
    repoInfo.defaultBranch,
    manifestPath,
    accessToken
  )

  if (!manifestContent) {
    return {
      success: false,
      error: `Manifest file not found at ${manifestPath}. Templates must have an orbit-template.yaml file.`
    }
  }

  // Parse manifest
  const { manifest, errors } = parseManifest(manifestContent)
  if (!manifest) {
    return {
      success: false,
      error: `Invalid manifest: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`
    }
  }

  // Check for existing template with same URL
  const existing = await payload.find({
    collection: 'templates',
    where: {
      repoUrl: { equals: input.repoUrl },
      workspace: { equals: input.workspaceId },
    },
    limit: 1,
  })

  if (existing.docs.length > 0) {
    return { success: false, error: 'This repository is already imported as a template in this workspace' }
  }

  // Generate slug from template name
  const slug = manifest.metadata.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // Create template
  const template = await payload.create({
    collection: 'templates',
    data: {
      name: manifest.metadata.name,
      slug,
      description: manifest.metadata.description || repoInfo.description || '',
      workspace: input.workspaceId,
      visibility: 'workspace',
      gitProvider: 'github',
      repoUrl: input.repoUrl,
      defaultBranch: repoInfo.defaultBranch,
      isGitHubTemplate: repoInfo.isTemplate,
      language: manifest.metadata.language,
      framework: manifest.metadata.framework,
      categories: filterValidCategories(manifest.metadata.categories),
      tags: manifest.metadata.tags?.map(tag => ({ tag })),
      complexity: manifest.metadata.complexity,
      manifestPath,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'synced',
      variables: manifest.variables || [],
      createdBy: session.user.id,
    },
  })

  revalidatePath('/templates')

  return {
    success: true,
    templateId: template.id as string,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Internal function to sync template manifest (no auth required)
 */
async function syncTemplateManifestInternal(templateId: string): Promise<ImportTemplateResult> {
  const payload = await getPayload({ config })

  const template = await payload.findByID({
    collection: 'templates',
    id: templateId,
    overrideAccess: true,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Get GitHub installation token
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
    overrideAccess: true,
  })

  // Get existing sync history early (cast needed until Payload types are regenerated)
  const existingSyncHistory = ((template as unknown as { syncHistory?: Array<{ timestamp: string; status: string; error?: string }> }).syncHistory) || []

  if (installation.docs.length === 0) {
    const newHistory = [
      {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: 'No GitHub App installation found',
      },
      ...existingSyncHistory.slice(0, 9), // Keep last 9, plus new = 10 total
    ]

    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'No GitHub App installation found',
        syncHistory: newHistory,
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    return { success: false, error: 'No GitHub App installation found' }
  }

  const accessToken = decrypt(installation.docs[0].installationToken as string)
  const parsed = parseGitHubUrl(template.repoUrl)

  if (!parsed) {
    const newHistory = [
      {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: 'Invalid repository URL',
      },
      ...existingSyncHistory.slice(0, 9), // Keep last 9, plus new = 10 total
    ]

    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'Invalid repository URL',
        syncHistory: newHistory,
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    return { success: false, error: 'Invalid repository URL' }
  }

  // Fetch manifest
  const manifestContent = await fetchManifestContent(
    parsed.owner,
    parsed.repo,
    template.defaultBranch || 'main',
    template.manifestPath || 'orbit-template.yaml',
    accessToken
  )

  if (!manifestContent) {
    const newHistory = [
      {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: 'Manifest file not found',
      },
      ...existingSyncHistory.slice(0, 9), // Keep last 9, plus new = 10 total
    ]

    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'Manifest file not found',
        syncHistory: newHistory,
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    return { success: false, error: 'Manifest file not found' }
  }

  const { manifest, errors } = parseManifest(manifestContent)

  if (!manifest) {
    const errorMessage = errors.map(e => e.message).join(', ')
    const newHistory = [
      {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: errorMessage,
      },
      ...existingSyncHistory.slice(0, 9), // Keep last 9, plus new = 10 total
    ]

    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: errorMessage,
        syncHistory: newHistory,
      } as Record<string, unknown>,
      overrideAccess: true,
    })
    return { success: false, error: 'Invalid manifest' }
  }

  // Update template with successful sync
  const newHistory = [
    {
      timestamp: new Date().toISOString(),
      status: 'success',
    },
    ...existingSyncHistory.slice(0, 9), // Keep last 9, plus new = 10 total
  ]

  await payload.update({
    collection: 'templates',
    id: templateId,
    data: {
      name: manifest.metadata.name,
      description: manifest.metadata.description,
      language: manifest.metadata.language,
      framework: manifest.metadata.framework,
      categories: filterValidCategories(manifest.metadata.categories),
      tags: manifest.metadata.tags?.map(tag => ({ tag })),
      complexity: manifest.metadata.complexity,
      variables: manifest.variables || [],
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'synced',
      syncError: null,
      syncHistory: newHistory,
    } as Record<string, unknown>,
    overrideAccess: true,
  })

  revalidatePath('/templates')
  revalidatePath(`/templates/${template.slug}`)

  return { success: true, templateId }
}

/**
 * Sync template manifest from GitHub (requires authentication)
 */
export async function syncTemplateManifest(templateId: string): Promise<ImportTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  return syncTemplateManifestInternal(templateId)
}

export interface InstantiateTemplateInput {
  templateId: string
  repoName: string
  repoDescription?: string
  workspaceId: string
  githubOrg: string
  isPrivate: boolean
  variables: Record<string, string | number | boolean>
}

export interface InstantiateTemplateResult {
  success: boolean
  workflowId?: string
  repoUrl?: string
  error?: string
}

/**
 * Create a new repository from a template
 * TODO: Connect to Temporal workflow in Phase 4
 */
export async function instantiateTemplate(
  input: InstantiateTemplateInput
): Promise<InstantiateTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Validate template exists
  const template = await payload.findByID({
    collection: 'templates',
    id: input.templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  // Validate workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Validate required variables
  const templateVars = (template.variables as Array<{ key: string; required: boolean }>) || []
  for (const v of templateVars) {
    if (v.required && !input.variables[v.key]) {
      return { success: false, error: `Missing required variable: ${v.key}` }
    }
  }

  // TODO: Phase 4 - Start Temporal workflow
  // For now, return a placeholder success
  // The actual implementation will:
  // 1. Start TemplateInstantiationWorkflow
  // 2. Return the workflow ID for progress tracking

  // Increment usage count
  await payload.update({
    collection: 'templates',
    id: input.templateId,
    data: {
      usageCount: (template.usageCount || 0) + 1,
    },
  })

  return {
    success: true,
    workflowId: `placeholder-${Date.now()}`,
    // In Phase 4, this will redirect to progress tracking page
  }
}

export interface UpdateTemplateInput {
  templateId: string
  name?: string
  description?: string
  visibility?: 'workspace' | 'shared' | 'public'
  sharedWith?: string[]
}

export interface UpdateTemplateResult {
  success: boolean
  error?: string
}

/**
 * Update template metadata
 */
export async function updateTemplate(input: UpdateTemplateInput): Promise<UpdateTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Get the template
  const template = await payload.findByID({
    collection: 'templates',
    id: input.templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Check if user is admin/owner in the template's workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Permission denied. You must be an admin or owner of this workspace.' }
  }

  // Build update data
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.description !== undefined) updateData.description = input.description
  if (input.visibility !== undefined) updateData.visibility = input.visibility
  if (input.sharedWith !== undefined) updateData.sharedWith = input.sharedWith

  // Update slug if name changed
  if (input.name && input.name !== template.name) {
    updateData.slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // Update template
  await payload.update({
    collection: 'templates',
    id: input.templateId,
    data: updateData,
  })

  // Revalidate paths
  revalidatePath('/templates')
  revalidatePath(`/templates/${template.slug}`)
  if (updateData.slug) {
    revalidatePath(`/templates/${updateData.slug}`)
  }

  return { success: true }
}

/**
 * Delete a template (only by workspace owners)
 */
export async function deleteTemplate(templateId: string): Promise<UpdateTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Get the template
  const template = await payload.findByID({
    collection: 'templates',
    id: templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Check if user is owner in the template's workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { equals: 'owner' } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Permission denied. Only workspace owners can delete templates.' }
  }

  // Delete template
  await payload.delete({
    collection: 'templates',
    id: templateId,
  })

  // Revalidate paths
  revalidatePath('/templates')

  return { success: true }
}

/**
 * Archive a template (soft delete by setting visibility to workspace and removing sharing)
 */
export async function archiveTemplate(templateId: string): Promise<UpdateTemplateResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Get the template
  const template = await payload.findByID({
    collection: 'templates',
    id: templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Check if user is admin/owner in the template's workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Permission denied. You must be an admin or owner of this workspace.' }
  }

  // Archive by setting visibility to workspace and clearing shared list
  await payload.update({
    collection: 'templates',
    id: templateId,
    data: {
      visibility: 'workspace',
      sharedWith: [],
    },
  })

  // Revalidate paths
  revalidatePath('/templates')
  revalidatePath(`/templates/${template.slug}`)

  return { success: true }
}

/**
 * Register a GitHub webhook for a template
 */
export async function registerTemplateWebhook(templateId: string): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Get the template
  const template = await payload.findByID({
    collection: 'templates',
    id: templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Check if user is admin/owner in the template's workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Permission denied. You must be an admin or owner of this workspace.' }
  }

  // Check if webhook already exists
  if (template.webhookId) {
    return { success: false, error: 'Webhook already exists. Unregister it first to create a new one.' }
  }

  // Get GitHub installation token for this workspace
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    return { success: false, error: 'No GitHub App installation found for this workspace' }
  }

  const accessToken = decrypt(installation.docs[0].installationToken as string)
  if (!accessToken) {
    return { success: false, error: 'GitHub access token not available' }
  }

  // Parse repository URL
  const parsed = parseGitHubUrl(template.repoUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid repository URL' }
  }

  // Generate webhook secret
  const webhookSecret = generateWebhookSecret()

  // Get webhook URL from environment
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookUrl = `${appUrl}/api/webhooks/github/template-sync`

  // Create webhook on GitHub
  const octokit = new Octokit({ auth: accessToken })

  try {
    const { data: hook } = await octokit.repos.createWebhook({
      owner: parsed.owner,
      repo: parsed.repo,
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret: webhookSecret,
        insecure_ssl: '0',
      },
    })

    // Store webhook ID and secret in template
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        webhookId: String(hook.id),
        webhookSecret,
      },
    })

    revalidatePath(`/templates/${template.slug}`)
    revalidatePath(`/templates/${template.slug}/edit`)

    return { success: true }
  } catch (error: unknown) {
    console.error('[registerTemplateWebhook] Error creating webhook:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Failed to create webhook: ${errorMessage}` }
  }
}

/**
 * Unregister a GitHub webhook for a template
 */
export async function unregisterTemplateWebhook(templateId: string): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Get the template
  const template = await payload.findByID({
    collection: 'templates',
    id: templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Check if user is admin/owner in the template's workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Permission denied. You must be an admin or owner of this workspace.' }
  }

  // Check if webhook exists
  if (!template.webhookId) {
    return { success: false, error: 'No webhook registered for this template' }
  }

  // Get GitHub installation token for this workspace
  const installation = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: workspaceId },
      status: { equals: 'active' },
    },
    limit: 1,
  })

  if (installation.docs.length === 0) {
    return { success: false, error: 'No GitHub App installation found for this workspace' }
  }

  const accessToken = decrypt(installation.docs[0].installationToken as string)
  if (!accessToken) {
    return { success: false, error: 'GitHub access token not available' }
  }

  // Parse repository URL
  const parsed = parseGitHubUrl(template.repoUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid repository URL' }
  }

  // Delete webhook from GitHub
  const octokit = new Octokit({ auth: accessToken })

  try {
    await octokit.repos.deleteWebhook({
      owner: parsed.owner,
      repo: parsed.repo,
      hook_id: parseInt(template.webhookId, 10),
    })

    // Clear webhook ID and secret from template
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        webhookId: null,
        webhookSecret: null,
      },
    })

    revalidatePath(`/templates/${template.slug}`)
    revalidatePath(`/templates/${template.slug}/edit`)

    return { success: true }
  } catch (error: unknown) {
    console.error('[unregisterTemplateWebhook] Error deleting webhook:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // If webhook doesn't exist on GitHub (404), clear it from our database anyway
    if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
      await payload.update({
        collection: 'templates',
        id: templateId,
        data: {
          webhookId: null,
          webhookSecret: null,
        },
      })
      return { success: true }
    }

    return { success: false, error: `Failed to delete webhook: ${errorMessage}` }
  }
}
