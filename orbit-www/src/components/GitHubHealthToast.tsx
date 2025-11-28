'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useGitHubHealth } from '@/contexts/GitHubHealthContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react'

const TOAST_ID = 'github-health-toast'

export function GitHubHealthToast() {
  const { health, dismissedUntil, dismiss, refresh } = useGitHubHealth()
  const toastShownRef = useRef(false)

  useEffect(() => {
    // Don't show if dismissed
    if (dismissedUntil && dismissedUntil > new Date()) {
      toast.dismiss(TOAST_ID)
      toastShownRef.current = false
      return
    }

    // Don't show if healthy or no data yet
    if (!health || health.healthy) {
      toast.dismiss(TOAST_ID)
      toastShownRef.current = false
      return
    }

    // Find installations with invalid tokens
    const invalidInstallations = health.installations.filter(inst => !inst.tokenValid)

    if (invalidInstallations.length === 0) {
      toast.dismiss(TOAST_ID)
      toastShownRef.current = false
      return
    }

    // Show persistent toast
    if (!toastShownRef.current) {
      toastShownRef.current = true

      const accountNames = invalidInstallations.map(i => i.accountLogin).join(', ')
      const message = invalidInstallations.length === 1
        ? `Your GitHub token for "${accountNames}" has expired.`
        : `${invalidInstallations.length} GitHub connections need attention.`

      toast.custom(
        (t) => (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 shadow-lg max-w-md">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-900 dark:text-amber-100">
                  GitHub Connection Issue
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {message}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Repository operations will fail until resolved.
                </p>

                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 dark:border-amber-700"
                    onClick={() => {
                      refresh()
                      toast.dismiss(t)
                      toastShownRef.current = false
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 dark:border-amber-700"
                    onClick={() => {
                      window.location.href = '/settings/github'
                    }}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Settings
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-amber-700 dark:text-amber-300"
                      >
                        Dismiss
                        <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        dismiss('session')
                        toast.dismiss(t)
                        toastShownRef.current = false
                      }}>
                        For this session
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        dismiss('1hour')
                        toast.dismiss(t)
                        toastShownRef.current = false
                      }}>
                        For 1 hour
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        dismiss('24hours')
                        toast.dismiss(t)
                        toastShownRef.current = false
                      }}>
                        For 24 hours
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
        ),
        {
          id: TOAST_ID,
          duration: Infinity,
          position: 'bottom-right',
        }
      )
    }
  }, [health, dismissedUntil, dismiss, refresh])

  return null
}
