'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  createConnection,
  updateConnection,
  deleteConnection,
  validateConnection,
  startConnectionScan,
} from '@/app/actions/git-connections'
import type { AdminConnectionView } from '@/lib/connections/connections-core'

const DEFAULT_BASE_URL = 'https://dev.azure.com'

const PROVIDER_LABEL: Record<string, string> = {
  'azure-devops': 'Azure DevOps',
}

interface ConnectionsClientProps {
  connections: AdminConnectionView[]
}

/**
 * Platform Admin "Connections" surface (WP11). Lists non-GitHub git provider
 * connections (Azure DevOps), and drives create / edit / remove / validate /
 * scan. The PAT is write-only: it is never sent to the client, and editing
 * shows "PAT set — enter to replace" rather than the value.
 */
export function ConnectionsClient({ connections }: ConnectionsClientProps) {
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; connection: AdminConnectionView } | null
  >(null)

  if (connections.length === 0) {
    return (
      <>
        <Header onAdd={() => setDialog({ mode: 'create' })} />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Plug className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No connections yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Connect an Azure DevOps organization with a personal access token to scan its
            repositories for services and APIs.
          </p>
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="mr-2 h-4 w-4" /> Add connection
          </Button>
        </div>
        <ConnectionDialog state={dialog} onClose={() => setDialog(null)} />
      </>
    )
  }

  return (
    <>
      <Header onAdd={() => setDialog({ mode: 'create' })} />
      <div className="space-y-4">
        {connections.map((c) => (
          <ConnectionCard key={c.id} connection={c} onEdit={() => setDialog({ mode: 'edit', connection: c })} />
        ))}
      </div>
      <ConnectionDialog state={dialog} onClose={() => setDialog(null)} />
    </>
  )
}

function Header({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Azure DevOps organizations connected for catalog discovery.
        </p>
      </div>
      <Button onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" /> Add connection
      </Button>
    </div>
  )
}

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

function ConnectionCard({
  connection: c,
  onEdit,
}: {
  connection: AdminConnectionView
  onEdit: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [validating, setValidating] = useState(false)
  const [validateMsg, setValidateMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const onValidate = useCallback(() => {
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
              {c.patSet ? '' : ' · no credentials set'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onValidate} disabled={validating}>
              {validating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Validate
            </Button>
            <Button size="sm" onClick={onScan} disabled={isPending}>
              <Search className="mr-2 h-4 w-4" /> Scan
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

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; connection: AdminConnectionView }
  | null

function ConnectionDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const editing = state?.mode === 'edit' ? state.connection : null
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [project, setProject] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [pat, setPat] = useState('')

  // Reset the form whenever a dialog opens (create = blank, edit = prefill).
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const key = state ? (state.mode === 'edit' ? `edit:${state.connection.id}` : 'create') : null
  if (key && key !== initializedFor) {
    setInitializedFor(key)
    setName(editing?.name ?? '')
    setOrganization(editing?.organization ?? '')
    setProject(editing?.project ?? '')
    setBaseUrl(editing?.baseUrl ?? DEFAULT_BASE_URL)
    setPat('')
  }
  if (!key && initializedFor) setInitializedFor(null)

  const onSubmit = useCallback(() => {
    startTransition(async () => {
      const res = editing
        ? await updateConnection({
            id: editing.id,
            name,
            organization,
            project,
            baseUrl,
            // Write-only: only send a PAT when one was entered.
            ...(pat ? { pat } : {}),
          })
        : await createConnection({ name, organization, project, baseUrl, pat })
      if (!res.success) {
        toast.error(res.error ?? 'Failed to save connection')
        return
      }
      toast.success(editing ? 'Connection updated.' : 'Connection created.')
      onClose()
      router.refresh()
    })
  }, [editing, name, organization, project, baseUrl, pat, onClose, router])

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit connection' : 'Add connection'}</DialogTitle>
          <DialogDescription>
            Azure DevOps organization scanned for catalog discovery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conn-name">Name</Label>
            <Input
              id="conn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Azure DevOps"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conn-org">Organization</Label>
            <Input
              id="conn-org"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="acme"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conn-project">
              Project <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="conn-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Leave blank to scan all projects"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conn-baseurl">Base URL</Label>
            <Input
              id="conn-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conn-pat">Personal access token</Label>
            <Input
              id="conn-pat"
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder={editing?.patSet ? 'PAT set — enter to replace' : 'Paste the PAT'}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted. {editing?.patSet ? 'Leave blank to keep the current token.' : ''}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save changes' : 'Create connection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
