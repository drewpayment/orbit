'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { resolveManifestConflict } from '@/app/actions/apps'
import { toast } from 'sonner'

interface ManifestConflictBannerProps {
  conflictDetected: boolean
  appId: string
}

export function ManifestConflictBanner({ conflictDetected, appId }: ManifestConflictBannerProps) {
  const router = useRouter()
  const [isResolving, setIsResolving] = React.useState<'keep-orbit' | 'keep-repo' | null>(null)

  if (!conflictDetected) return null

  const handleResolve = async (resolution: 'keep-orbit' | 'keep-repo') => {
    setIsResolving(resolution)
    try {
      await resolveManifestConflict(appId, resolution)
      toast.success(
        resolution === 'keep-orbit'
          ? 'Conflict resolved — Orbit version pushed to repository'
          : 'Conflict resolved — repository version applied to Orbit',
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resolve conflict')
    } finally {
      setIsResolving(null)
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h4 className="font-medium text-amber-800 dark:text-amber-200">
            Sync conflict detected
          </h4>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            The manifest in your repository and Orbit both changed since the last sync.
            Choose which version to keep.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleResolve('keep-orbit')}
              disabled={isResolving !== null}
            >
              {isResolving === 'keep-orbit' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Keep Orbit Version
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleResolve('keep-repo')}
              disabled={isResolving !== null}
            >
              {isResolving === 'keep-repo' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Keep Repository Version
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
