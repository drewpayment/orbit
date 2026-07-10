'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { createConnection, updateConnection } from '@/app/actions/git-connections'
import type { AdminConnectionView } from '@/lib/connections/connections-core'

export const DEFAULT_BASE_URL = 'https://dev.azure.com'

export type ConnectionDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; connection: AdminConnectionView }
  | null

/**
 * Azure DevOps create/edit credential dialog (service-principal / PAT branches).
 * Secrets are write-only: an existing connection shows "… set — enter to
 * replace" and only sends a new value when one is typed.
 */
export function ConnectionDialog({
  state,
  onClose,
}: {
  state: ConnectionDialogState
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const editing = state?.mode === 'edit' ? state.connection : null
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [project, setProject] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [authType, setAuthType] = useState<'pat' | 'service-principal'>('service-principal')
  const [pat, setPat] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  // Reset the form whenever a dialog opens (create = blank, edit = prefill).
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const key = state ? (state.mode === 'edit' ? `edit:${state.connection.id}` : 'create') : null
  if (key && key !== initializedFor) {
    setInitializedFor(key)
    setName(editing?.name ?? '')
    setOrganization(editing?.organization ?? '')
    setProject(editing?.project ?? '')
    setBaseUrl(editing?.baseUrl ?? DEFAULT_BASE_URL)
    setAuthType(editing?.authType ?? 'service-principal')
    setPat('')
    setTenantId(editing?.tenantId ?? '')
    setClientId(editing?.clientId ?? '')
    setClientSecret('')
  }
  if (!key && initializedFor) setInitializedFor(null)

  const onSubmit = useCallback(() => {
    startTransition(async () => {
      const secretFields =
        authType === 'service-principal'
          ? {
              tenantId,
              clientId,
              // Write-only: only send a secret when one was entered.
              ...(clientSecret ? { clientSecret } : {}),
            }
          : { ...(pat ? { pat } : {}) }
      const res = editing
        ? await updateConnection({
            id: editing.id,
            name,
            organization,
            project,
            baseUrl,
            authType,
            ...secretFields,
          })
        : await createConnection({
            name,
            organization,
            project,
            baseUrl,
            authType,
            ...(authType === 'service-principal'
              ? { tenantId, clientId, clientSecret }
              : { pat }),
          })
      if (!res.success) {
        toast.error(res.error ?? 'Failed to save connection')
        return
      }
      toast.success(editing ? 'Connection updated.' : 'Connection created.')
      onClose()
      router.refresh()
    })
  }, [editing, name, organization, project, baseUrl, authType, pat, tenantId, clientId, clientSecret, onClose, router])

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit connection' : 'Add Azure DevOps connection'}</DialogTitle>
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
            <Label htmlFor="conn-authtype">Authentication</Label>
            <select
              id="conn-authtype"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={authType}
              onChange={(e) => setAuthType(e.target.value as 'pat' | 'service-principal')}
            >
              <option value="service-principal">Service principal (Microsoft Entra ID) — recommended</option>
              <option value="pat">Personal access token</option>
            </select>
            {authType === 'pat' && (
              <p className="text-xs text-muted-foreground">
                Microsoft is retiring global PATs (Dec 2026). Use a service principal unless this
                is an on-prem Azure DevOps Server.
              </p>
            )}
          </div>

          {authType === 'service-principal' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="conn-tenant">Tenant (directory) ID</Label>
                <Input
                  id="conn-tenant"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conn-client">Application (client) ID</Label>
                <Input
                  id="conn-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conn-secret">Client secret</Label>
                <Input
                  id="conn-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={editing?.secretSet ? 'Secret set — enter to replace' : 'Paste the client secret'}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted. {editing?.secretSet ? 'Leave blank to keep the current secret. ' : ''}
                  Orbit mints short-lived Entra tokens — no PAT needed.
                </p>
              </div>
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">One-time Azure setup</p>
                <ol className="ml-4 mt-1 list-decimal space-y-0.5">
                  <li>Entra admin center → App registrations → New registration.</li>
                  <li>Certificates &amp; secrets → New client secret (copy it here).</li>
                  <li>
                    Azure DevOps → Organization settings → Users → Add the app as a user with
                    Basic access (Readers works for scanning).
                  </li>
                </ol>
              </div>
            </>
          ) : (
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
          )}
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
