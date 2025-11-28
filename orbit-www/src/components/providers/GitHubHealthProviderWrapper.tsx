'use client'

import { useEffect, useState } from 'react'
import { GitHubHealthProvider } from '@/contexts/GitHubHealthContext'
import { GitHubHealthToast } from '@/components/GitHubHealthToast'
import { getCurrentWorkspaceId } from '@/lib/workspace'

interface GitHubHealthProviderWrapperProps {
  children: React.ReactNode
}

export function GitHubHealthProviderWrapper({ children }: GitHubHealthProviderWrapperProps) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getCurrentWorkspaceId()
      .then(setWorkspaceId)
      .finally(() => setIsLoading(false))
  }, [])

  // Don't block rendering while loading workspace
  if (isLoading) {
    return <>{children}</>
  }

  return (
    <GitHubHealthProvider workspaceId={workspaceId}>
      {children}
      <GitHubHealthToast />
    </GitHubHealthProvider>
  )
}
