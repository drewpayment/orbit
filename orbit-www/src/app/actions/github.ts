'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export interface GitHubInstallation {
  id: string
  installationId: number
  accountLogin: string
  accountAvatarUrl: string
  accountType: 'Organization' | 'User'
}

export async function getWorkspaceGitHubInstallations(workspaceId: string): Promise<{
  success: boolean
  error?: string
  installations: GitHubInstallation[]
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized', installations: [] }
  }

  const payload = await getPayload({ config })

  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      and: [
        { allowedWorkspaces: { contains: workspaceId } },
        { status: { equals: 'active' } },
      ],
    },
  })

  return {
    success: true,
    installations: installations.docs.map((doc) => ({
      id: doc.id as string,
      installationId: doc.installationId as number,
      accountLogin: doc.accountLogin as string,
      accountAvatarUrl: (doc.accountAvatarUrl as string) || '',
      accountType: doc.accountType as 'Organization' | 'User',
    })),
  }
}
