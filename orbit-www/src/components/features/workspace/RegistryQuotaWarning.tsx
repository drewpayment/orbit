'use client'

import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { getRegistryUsage, formatBytes, type RegistryUsage } from '@/app/actions/registry'

interface RegistryQuotaWarningProps {
  workspaceId: string
  /** Minimum percentage to show warning (default: 70) */
  warningThreshold?: number
  /** Percentage to show critical/destructive alert (default: 90) */
  criticalThreshold?: number
}

export function RegistryQuotaWarning({
  workspaceId,
  warningThreshold = 70,
  criticalThreshold = 90,
}: RegistryQuotaWarningProps) {
  const [usage, setUsage] = useState<RegistryUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchUsage() {
      try {
        const result = await getRegistryUsage(workspaceId)
        if (result.error) {
          setError(result.error)
        } else {
          setUsage(result.usage)
        }
      } catch (err) {
        setError('Failed to load registry usage')
        console.error('Registry usage fetch error:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchUsage()
  }, [workspaceId])

  // Don't show anything while loading or on error
  if (loading || error || !usage) {
    return null
  }

  // Don't show if below warning threshold
  if (usage.percentage < warningThreshold) {
    return null
  }

  const isCritical = usage.percentage >= criticalThreshold

  return (
    <Alert variant={isCritical ? 'destructive' : 'default'} className={!isCritical ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : ''}>
      {isCritical ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
      )}
      <AlertTitle className={!isCritical ? 'text-yellow-800 dark:text-yellow-200' : ''}>
        {isCritical ? 'Registry Storage Critical' : 'Registry Storage Warning'}
      </AlertTitle>
      <AlertDescription className={!isCritical ? 'text-yellow-700 dark:text-yellow-300' : ''}>
        {isCritical ? (
          <>
            Your container registry is at <strong>{usage.percentage}%</strong> capacity
            ({formatBytes(usage.currentBytes)} of {formatBytes(usage.quotaBytes)}).
            Old images will be automatically cleaned up during builds.
          </>
        ) : (
          <>
            Your container registry is at <strong>{usage.percentage}%</strong> capacity
            ({formatBytes(usage.currentBytes)} of {formatBytes(usage.quotaBytes)}).
            When storage reaches 80%, older images will be automatically cleaned up during builds.
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}
