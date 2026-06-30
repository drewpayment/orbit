'use client'

import { useEffect } from 'react'

import { useBreadcrumb } from '@/components/breadcrumb-provider'

interface Props {
  automationId: string
  automationName: string
}

// Pushes the breadcrumb trail for an automation detail page into the shared
// breadcrumb context so the site header shows Automations / <name> instead of
// the raw hex id the path-derived fallback would render. Cleared on unmount.
export function SetAutomationBreadcrumb({ automationId, automationName }: Props) {
  const { setItems } = useBreadcrumb()

  useEffect(() => {
    setItems([
      { label: 'Automations', href: '/automations' },
      { label: automationName, href: `/automations/${automationId}` },
    ])
    return () => setItems([])
  }, [automationId, automationName, setItems])

  return null
}
