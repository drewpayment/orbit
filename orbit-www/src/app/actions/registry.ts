'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export interface RegistryUsage {
  currentBytes: number
  quotaBytes: number
  percentage: number
  imageCount: number
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Get registry usage for a workspace
 * Returns current usage, quota, and percentage
 */
export async function getRegistryUsage(workspaceId: string): Promise<{
  usage: RegistryUsage | null
  error?: string
}> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { usage: null, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user has access to the workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
    })

    if (membership.docs.length === 0) {
      return { usage: null, error: 'Not a member of this workspace' }
    }

    // Get workspace to check for custom quota
    const workspace = await payload.findByID({
      collection: 'workspaces',
      id: workspaceId,
    })

    if (!workspace) {
      return { usage: null, error: 'Workspace not found' }
    }

    // Default quota is 5GB (5 * 1024 * 1024 * 1024 bytes)
    const defaultQuota = 5 * 1024 * 1024 * 1024
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotaBytes = (workspace as any).registryQuotaBytes || defaultQuota

    // Get all registry images for this workspace
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = await (payload as any).find({
      collection: 'registry-images',
      where: { workspace: { equals: workspaceId } },
      limit: 1000,
      overrideAccess: false,
    })

    // Sum up the sizes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentBytes = images.docs.reduce((sum: number, img: any) => {
      return sum + (img.sizeBytes || 0)
    }, 0)

    const percentage = quotaBytes > 0 ? Math.round((currentBytes / quotaBytes) * 100) : 0

    return {
      usage: {
        currentBytes,
        quotaBytes,
        percentage,
        imageCount: images.docs.length,
      },
    }
  } catch (error) {
    console.error('Failed to fetch registry usage:', error)
    return { usage: null, error: 'Failed to fetch registry usage' }
  }
}
