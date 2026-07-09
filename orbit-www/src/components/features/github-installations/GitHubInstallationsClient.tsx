'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Github,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  refreshInstallationToken,
  getInstallationRefreshState,
  getInstallationAppCount,
  deleteInstallationAdmin,
} from '@/app/actions/github-installations'
import type { AdminInstallationView, InstallationStatus } from '@/lib/github/installations-core'

const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || 'orbit-idp-dev'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 60000

// Status → badge presentation for the admin operational view. Unlike the
// member-facing Settings › GitHub page (which softens the vocabulary), this
// page names the raw health state so an admin can act on it.
function statusBadge(status: InstallationStatus): { label: string; className: string } {
  switch (status) {
    case 'active':
      return { label: 'Active', className: 'bg-green-100 text-green-800 border-transparent' }
    case 'refresh_failed':
      return { label: 'Refresh failed', className: 'bg-amber-100 text-amber-900 border-transparent' }
    case 'needs_reconnect':
      return { label: 'Needs reconnect', className: 'bg-red-100 text-red-800 border-transparent' }
    case 'suspended':
      return { label: 'Suspended', className: 'bg-gray-200 text-gray-700 border-transparent' }
  }
}

/** Compact relative time, e.g. "3 days ago" / "in 47 minutes". */
function relativeTime(iso: string | null): string {
  if (!iso) return 'unknown'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const diffMs = then - Date.now()
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const abs = Math.abs(diffMs)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ]
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') {
      return rtf.format(Math.round(diffMs / ms), unit)
    }
  }
  return 'just now'
}

function githubInstallUrl(): string {
  const state = crypto.randomUUID()
  try {
    sessionStorage.setItem('github_install_state', state)
  } catch {
    // sessionStorage may be unavailable; the state param is best-effort CSRF.
  }
  return `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`
}

type RefreshPhase = 'idle' | 'refreshing' | 'success' | 'failed' | 'timeout'
interface RefreshUiState {
  phase: RefreshPhase
  message?: string
}

interface GitHubInstallationsClientProps {
  installations: AdminInstallationView[]
}

export function GitHubInstallationsClient({ installations: initial }: GitHubInstallationsClientProps) {
  const [installations, setInstallations] = useState<AdminInstallationView[]>(initial)
  const [refreshState, setRefreshState] = useState<Record<string, RefreshUiState>>({})

  useEffect(() => setInstallations(initial), [initial])

  // Track live poll timers so we can cancel them on unmount.
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  useEffect(() => {
    const active = timers.current
    return () => {
      for (const t of active) clearTimeout(t)
      active.clear()
    }
  }, [])

  const setPhase = useCallback((docId: string, state: RefreshUiState) => {
    setRefreshState((prev) => ({ ...prev, [docId]: state }))
  }, [])

  const applyState = useCallback(
    (docId: string, next: { status: InstallationStatus; tokenExpiresAt: string | null; tokenExpired: boolean }) => {
      setInstallations((prev) =>
        prev.map((inst) => (inst.id === docId ? { ...inst, ...next } : inst)),
      )
    },
    [],
  )

  const onRefresh = useCallback(
    (docId: string) => {
      setPhase(docId, { phase: 'refreshing' })
      void (async () => {
        const res = await refreshInstallationToken(docId)
        if (!res.success) {
          setPhase(docId, { phase: 'failed', message: res.error ?? 'Failed to trigger refresh' })
          toast.error(res.error ?? 'Failed to trigger token refresh')
          return
        }
        toast.success('Refresh requested — waiting for a fresh token…')

        const deadline = Date.now() + POLL_TIMEOUT_MS
        const poll = async () => {
          const r = await getInstallationRefreshState(docId)
          if (r.success && r.state) {
            applyState(docId, r.state)
            if (!r.state.tokenExpired) {
              setPhase(docId, { phase: 'success' })
              toast.success('Token refreshed.')
              return
            }
          }
          if (Date.now() >= deadline) {
            setPhase(docId, {
              phase: 'timeout',
              message: 'No fresh token yet. The refresher may be recovering — try again shortly.',
            })
            return
          }
          const t = setTimeout(() => {
            timers.current.delete(t)
            void poll()
          }, POLL_INTERVAL_MS)
          timers.current.add(t)
        }
        const t = setTimeout(() => {
          timers.current.delete(t)
          void poll()
        }, POLL_INTERVAL_MS)
        timers.current.add(t)
      })()
    },
    [applyState, setPhase],
  )

  const onRemoved = useCallback((docId: string) => {
    setInstallations((prev) => prev.filter((inst) => inst.id !== docId))
  }, [])

  if (installations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <Github className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">No GitHub App installations connected</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Install the Orbit GitHub App into a GitHub organization to enable repository operations,
          catalog discovery, and template launches.
        </p>
        <Button asChild>
          <a href={githubInstallUrl()}>
            <Github className="mr-2 h-4 w-4" /> Install GitHub App
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {installations.map((inst) => (
        <InstallationCard
          key={inst.id}
          installation={inst}
          refresh={refreshState[inst.id] ?? { phase: 'idle' }}
          onRefresh={() => onRefresh(inst.id)}
          onRemoved={() => onRemoved(inst.id)}
        />
      ))}
    </div>
  )
}

function InstallationCard({
  installation: inst,
  refresh,
  onRefresh,
  onRemoved,
}: {
  installation: AdminInstallationView
  refresh: RefreshUiState
  onRefresh: () => void
  onRemoved: () => void
}) {
  const badge = statusBadge(inst.status)
  const refreshing = refresh.phase === 'refreshing'
  const manageUrl = `https://github.com/settings/installations/${inst.installationId}`

  const [confirmRemove, setConfirmRemove] = useState(false)
  const [appCount, setAppCount] = useState<number | null>(null)
  const [removing, setRemoving] = useState(false)

  const openRemove = useCallback(() => {
    setAppCount(null)
    setConfirmRemove(true)
    // Prefetch the blast radius so the dialog can name it.
    void getInstallationAppCount(inst.id).then((res) => {
      if (res.success) setAppCount(res.count)
    })
  }, [inst.id])

  const onRemove = useCallback(() => {
    setRemoving(true)
    void (async () => {
      const res = await deleteInstallationAdmin(inst.id)
      setRemoving(false)
      if (!res.success) {
        toast.error(res.error ?? 'Failed to remove installation')
        return
      }
      toast.success('Installation removed. Remember to uninstall the app on GitHub.')
      setConfirmRemove(false)
      onRemoved()
    })()
  }, [inst.id, onRemoved])

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{inst.accountLogin}</h3>
              <Badge className={badge.className}>{badge.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Installation ID {inst.installationId} ·{' '}
              {inst.repositorySelection === 'all'
                ? 'All repositories'
                : `${inst.selectedRepositoryCount} selected ${
                    inst.selectedRepositoryCount === 1 ? 'repository' : 'repositories'
                  }`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {refreshing ? 'Refreshing…' : 'Refresh token'}
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/settings/github/${inst.id}/configure`}>Configure workspaces</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={manageUrl} target="_blank" rel="noopener noreferrer">
                Manage on GitHub <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={openRemove}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </Button>
          </div>
        </div>

        {/* Token health — the signal that was missing during the incident. */}
        <TokenHealthLine tokenExpiresAt={inst.tokenExpiresAt} tokenExpired={inst.tokenExpired} />

        {/* Refresh outcome feedback. */}
        {refresh.phase === 'success' && (
          <p className="flex items-center gap-1.5 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" /> Token refreshed.
          </p>
        )}
        {(refresh.phase === 'failed' || refresh.phase === 'timeout') && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {refresh.message}
          </p>
        )}

        {/* Needs-reconnect guidance: a refresh cannot recover a revoked/removed app. */}
        {inst.status === 'needs_reconnect' && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
            <p className="font-medium text-red-800">Action required — reconnect on GitHub</p>
            <p className="mt-1 text-red-700">
              {inst.lastFailureReason ||
                'Orbit can no longer authenticate to this installation. A token refresh will not recover it — reinstall or re-authorize the app on GitHub.'}
            </p>
            <Button asChild size="sm" className="mt-3">
              <a href={githubInstallUrl()}>Reconnect on GitHub</a>
            </Button>
          </div>
        )}

        {/* Allowed workspaces. */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Allowed workspaces</p>
          {inst.allowedWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">None assigned</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {inst.allowedWorkspaces.map((ws) => (
                <Badge key={ws.id} variant="secondary">
                  {ws.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {inst.accountLogin}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {appCount === null
                    ? 'Checking how many apps reference this installation…'
                    : appCount === 0
                      ? 'No apps currently reference this installation.'
                      : `${appCount} app${appCount === 1 ? '' : 's'} reference this installation. They keep their data, but lose GitHub access at their next token use.`}
                </p>
                <p>
                  Removing here deletes Orbit&apos;s record and stops token refresh. It does{' '}
                  <span className="font-medium">not</span> uninstall the app on GitHub — you must
                  also{' '}
                  <a
                    href={manageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    uninstall it on GitHub
                  </a>
                  .
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onRemove()
              }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Remove installation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function TokenHealthLine({
  tokenExpiresAt,
  tokenExpired,
}: {
  tokenExpiresAt: string | null
  tokenExpired: boolean
}) {
  if (tokenExpired) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <span className="font-medium text-red-800">
          Token EXPIRED {tokenExpiresAt ? relativeTime(tokenExpiresAt) : ''}
        </span>
      </div>
    )
  }
  return (
    <p className="text-sm text-muted-foreground">
      Token valid until{' '}
      <span className="font-medium text-foreground">
        {tokenExpiresAt ? new Date(tokenExpiresAt).toLocaleString() : 'unknown'}
      </span>{' '}
      ({tokenExpiresAt ? relativeTime(tokenExpiresAt) : 'unknown'})
    </p>
  )
}
