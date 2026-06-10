'use client'

import { useEffect } from 'react'

import { useBreadcrumb } from '@/components/breadcrumb-provider'

interface Props {
  workspaceSlug: string
  workspaceName: string
  runTitle: string
}

// Pushes the breadcrumb trail for an Infrastructure Agent run page into
// the shared breadcrumb context. The site header subscribes to that
// context, so the topbar renders Workspaces / <workspace> / Infra Agent
// / <run title> while this page is mounted.
export function SetAgentBreadcrumbs({ workspaceSlug, workspaceName, runTitle }: Props) {
  const { setItems, setWorkspaceName } = useBreadcrumb()

  useEffect(() => {
    setWorkspaceName(workspaceName)
    setItems([
      { label: 'Workspaces', href: '/workspaces' },
      { label: workspaceName, href: `/workspaces/${workspaceSlug}` },
      { label: 'Infra Agent', href: `/workspaces/${workspaceSlug}/infra-agent` },
      { label: runTitle, href: '' },
    ])
    return () => {
      setItems([])
      setWorkspaceName(undefined)
    }
  }, [workspaceSlug, workspaceName, runTitle, setItems, setWorkspaceName])

  return null
}
