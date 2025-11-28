'use client'

import { useEffect, useState } from 'react'
import { GitHubHealthProvider } from '@/contexts/GitHubHealthContext'
import { GitHubHealthToast } from '@/components/GitHubHealthToast'
import { getAllWorkspaceIds } from '@/lib/workspace'

interface GitHubHealthProviderWrapperProps {
  children: React.ReactNode
}

export function GitHubHealthProviderWrapper({ children }: GitHubHealthProviderWrapperProps) {
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getAllWorkspaceIds()
      .then(setWorkspaceIds)
      .finally(() => setIsLoading(false))
  }, [])

  // Don't block rendering while loading workspace
  if (isLoading) {
    return <>{children}</>
  }

  return (
    <GitHubHealthProvider workspaceIds={workspaceIds}>
      {children}
      <GitHubHealthToast />
    </GitHubHealthProvider>
  )
}
