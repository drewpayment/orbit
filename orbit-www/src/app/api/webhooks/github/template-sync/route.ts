import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { parseManifest } from '@/lib/template-manifest'
import { parseGitHubUrl, fetchManifestContent } from '@/lib/github-manifest'
import { revalidatePath } from 'next/cache'

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

/**
 * Internal function to sync template manifest (webhook-safe, bypasses auth)
 */
async function syncTemplateManifestInternal(templateId: string): Promise<{ success: boolean; error?: string }> {
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

  if (installation.docs.length === 0) {
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'No GitHub App installation found',
      },
      overrideAccess: true,
    })
    return { success: false, error: 'No GitHub App installation found' }
  }

  const accessToken = installation.docs[0].installationToken as string
  const parsed = parseGitHubUrl(template.repoUrl)

  if (!parsed) {
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
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: 'Manifest file not found',
      },
      overrideAccess: true,
    })
    return { success: false, error: 'Manifest file not found' }
  }

  const { manifest, errors } = parseManifest(manifestContent)

  if (!manifest) {
    await payload.update({
      collection: 'templates',
      id: templateId,
      data: {
        syncStatus: 'error',
        syncError: errors.map(e => e.message).join(', '),
      },
      overrideAccess: true,
    })
    return { success: false, error: 'Invalid manifest' }
  }

  // Update template
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
    },
    overrideAccess: true,
  })

  revalidatePath('/templates')
  revalidatePath(`/templates/${template.slug}`)

  return { success: true }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Get signature header
    const signature = request.headers.get('X-Hub-Signature-256')
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    // 2. Get raw body for signature verification
    const body = await request.text()

    // 3. Get event type
    const event = request.headers.get('X-GitHub-Event')
    if (event !== 'push') {
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 })
    }

    // 4. Parse payload
    let payload
    try {
      payload = JSON.parse(body)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    const repoFullName = payload.repository?.full_name
    const defaultBranch = payload.repository?.default_branch
    const pushedRef = payload.ref // e.g., "refs/heads/main"

    if (!repoFullName || !defaultBranch || !pushedRef) {
      return NextResponse.json({ error: 'Missing required fields in payload' }, { status: 400 })
    }

    // 5. Only process pushes to default branch
    if (pushedRef !== `refs/heads/${defaultBranch}`) {
      return NextResponse.json({
        message: 'Not default branch',
        branch: pushedRef,
        defaultBranch: `refs/heads/${defaultBranch}`
      }, { status: 200 })
    }

    // 6. Find templates by repo URL
    const db = await getPayload({ config })
    const templates = await db.find({
      collection: 'templates',
      where: {
        repoUrl: { contains: repoFullName },
      },
      limit: 1000,
    })

    if (templates.docs.length === 0) {
      return NextResponse.json({
        message: 'No templates found for repository',
        repository: repoFullName
      }, { status: 200 })
    }

    // 7. Verify signature for each matching template and sync
    const results: Array<{ templateId: string; success: boolean; error?: string }> = []

    for (const template of templates.docs) {
      if (!template.webhookSecret) {
        results.push({
          templateId: template.id as string,
          success: false,
          error: 'No webhook secret configured'
        })
        continue
      }

      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', template.webhookSecret)
        .update(body)
        .digest('hex')

      // Use timing-safe comparison to prevent timing attacks
      const signatureValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )

      if (signatureValid) {
        try {
          const result = await syncTemplateManifestInternal(template.id as string)
          results.push({
            templateId: template.id as string,
            success: result.success,
            error: result.error
          })
        } catch (error) {
          results.push({
            templateId: template.id as string,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      } else {
        results.push({
          templateId: template.id as string,
          success: false,
          error: 'Invalid signature'
        })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failureCount = results.filter(r => !r.success).length

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: failureCount,
      results
    })

  } catch (error) {
    console.error('[GitHub Webhook] Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
