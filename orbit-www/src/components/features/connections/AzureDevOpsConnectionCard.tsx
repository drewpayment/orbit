'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Search,
  Trash2,
  Users,
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
import {
  deleteConnection,
  validateConnection,
  startConnectionScan,
} from '@/app/actions/git-connections'
import type { AdminConnectionView } from '@/lib/connections/connections-core'
import type { WorkspaceDialogTarget } from './WorkspaceAssignmentDialog'

const DEFAULT_BASE_URL = 'https://dev.azure.com'

const PROVIDER_LABEL: Record<string, string> = {
  'azure-devops': 'Azure DevOps',
}

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

/**
 * Azure DevOps connection card on the unified Connections page. Preserves the
 * provider/status badges, org/project/baseUrl subtitle, last-validated +
 * auth-mode line, and inline error text — with "Check health" (validate) and
 * Scan as shared verbs, plus workspace badges + assignment (parity with GitHub).
 */
export function AzureDevOpsConnectionCard({
  connection: c,
  onEdit,
  onWorkspaces,
}: {
  connection: AdminConnectionView
  onEdit: () => void
  onWorkspaces: (target: WorkspaceDialogTarget) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [validating, setValidating] = useState(false)
  const [validateMsg, setValidateMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const onCheckHealth = useCallback(() => {
    setValidating(true)
    setValidateMsg(null)
    void (async () => {
      const res = await validateConnection(c.id)
      setValidating(false)
      if (res.success) {
        setValidateMsg({ ok: true, text: 'Connection validated.' })
        toast.success('Connection validated.')
      } else {
        setValidateMsg({ ok: false, text: res.error ?? 'Validation failed.' })
        toast.error(res.error ?? 'Validation failed.')
      }
      router.refresh()
    })()
  }, [c.id, router])

  const onScan = useCallback(() => {
    startTransition(async () => {
      const res = await startConnectionScan(c.id)
      if (!res.success) {
        toast.error(res.error ?? 'Failed to start scan')
        return
      }
      toast.success('Scan started — review proposals in Discovery.')
    })
  }, [c.id])

  const onRemove = useCallback(() => {
    startTransition(async () => {
      const res = await deleteConnection(c.id)
      if (!res.success) {
        toast.error(res.error ?? 'Failed to remove connection')
        return
      }
      toast.success('Connection removed.')
      setConfirmRemove(false)
      router.refresh()
    })
  }, [c.id, router])

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{c.name}</h3>
              <Badge variant="secondary">{providerLabel(c.provider)}</Badge>
              {c.status === 'error' ? (
                <Badge className="border-transparent bg-red-100 text-red-800">Error</Badge>
              ) : (
                <Badge className="border-transparent bg-green-100 text-green-800">Active</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {c.organization}
              {c.project ? ` / ${c.project}` : ' · all projects'}
              {c.baseUrl && c.baseUrl !== DEFAULT_BASE_URL ? ` · ${c.baseUrl}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.lastValidatedAt
                ? `Last validated ${new Date(c.lastValidatedAt).toLocaleString()}`
                : 'Not validated yet'}
              {c.authType === 'service-principal'
                ? ` · service principal${c.secretSet ? '' : ' · no secret set'}`
                : c.patSet
                  ? ' · PAT'
                  : ' · no credentials set'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onCheckHealth} disabled={validating}>
              {validating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {validating ? 'Checking…' : 'Check health'}
            </Button>
            <Button size="sm" variant="outline" onClick={onScan} disabled={isPending}>
              <Search className="mr-2 h-4 w-4" /> Scan
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onWorkspaces({
                  provider: 'azure-devops',
                  id: c.id,
                  name: c.name,
                  allowedWorkspaceIds: c.allowedWorkspaces.map((w) => w.id),
                })
              }
            >
              <Users className="mr-2 h-4 w-4" /> Workspaces
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </Button>
          </div>
        </div>

        {c.status === 'error' && c.lastError && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {c.lastError}
          </p>
        )}
        {validateMsg && (
          <p
            className={
              validateMsg.ok
                ? 'flex items-center gap-1.5 text-sm text-green-700'
                : 'flex items-center gap-1.5 text-sm text-destructive'
            }
          >
            {validateMsg.ok ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            {validateMsg.text}
          </p>
        )}

        {/* Allowed workspaces (parity with GitHub cards). */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Allowed workspaces</p>
          {c.allowedWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">None assigned</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {c.allowedWorkspaces.map((ws) => (
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
            <AlertDialogTitle>Remove “{c.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Entities already discovered from this connection keep their catalog rows, but new
              scans will stop and the stored credentials are deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onRemove()
              }}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Remove connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
