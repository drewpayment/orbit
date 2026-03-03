'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Cloud,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Pencil,
  Plug,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getAllCloudAccounts,
  createCloudAccount,
  updateCloudAccount,
  deleteCloudAccount,
  testCloudAccountConnection,
  type CloudAccountDoc,
  type WorkspaceOption,
  type UserOption,
} from '@/app/actions/cloud-accounts'

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

const PROVIDER_META: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  aws: { label: 'AWS', icon: 'AWS', color: 'bg-orange-100 text-orange-700' },
  gcp: { label: 'GCP', icon: 'GCP', color: 'bg-blue-100 text-blue-700' },
  azure: { label: 'Azure', icon: 'AZ', color: 'bg-sky-100 text-sky-700' },
  digitalocean: { label: 'DigitalOcean', icon: 'DO', color: 'bg-indigo-100 text-indigo-700' },
}

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
  connected: { variant: 'default', className: 'bg-green-600' },
  disconnected: { variant: 'secondary' },
  error: { variant: 'destructive' },
}

// ---------------------------------------------------------------------------
// Form state type
// ---------------------------------------------------------------------------

interface FormState {
  name: string
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean'
  // AWS
  awsAccessKeyId: string
  awsSecretAccessKey: string
  // GCP
  gcpServiceAccountJson: string
  // Azure
  azureTenantId: string
  azureClientId: string
  azureClientSecret: string
  // DigitalOcean
  doApiToken: string
  // Common
  region: string
  workspaces: string[]
  approvalRequired: boolean
  approvers: string[]
}

const EMPTY_FORM: FormState = {
  name: '',
  provider: 'aws',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
  gcpServiceAccountJson: '',
  azureTenantId: '',
  azureClientId: '',
  azureClientSecret: '',
  doApiToken: '',
  region: '',
  workspaces: [],
  approvalRequired: false,
  approvers: [],
}

function credentialsFromForm(form: FormState): Record<string, unknown> {
  switch (form.provider) {
    case 'aws':
      return { accessKeyId: form.awsAccessKeyId, secretAccessKey: form.awsSecretAccessKey }
    case 'gcp':
      return { serviceAccountJson: form.gcpServiceAccountJson }
    case 'azure':
      return { tenantId: form.azureTenantId, clientId: form.azureClientId, clientSecret: form.azureClientSecret }
    case 'digitalocean':
      return { apiToken: form.doApiToken }
    default:
      return {}
  }
}

function formFromCredentials(
  provider: string,
  credentials: Record<string, unknown> | null,
): Partial<FormState> {
  if (!credentials) return {}
  switch (provider) {
    case 'aws':
      return {
        awsAccessKeyId: (credentials.accessKeyId as string) || '',
        awsSecretAccessKey: '', // never pre-fill secrets
      }
    case 'gcp':
      return { gcpServiceAccountJson: '' } // never pre-fill
    case 'azure':
      return {
        azureTenantId: (credentials.tenantId as string) || '',
        azureClientId: (credentials.clientId as string) || '',
        azureClientSecret: '', // never pre-fill
      }
    case 'digitalocean':
      return { doApiToken: '' } // never pre-fill
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CloudAccountsSettingsClient() {
  const [accounts, setAccounts] = useState<CloudAccountDoc[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CloudAccountDoc | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await getAllCloudAccounts()
      if (result.error) {
        setError(result.error)
        return
      }
      setAccounts(result.accounts)
      setWorkspaces(result.workspaces)
      setUsers(result.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Open dialogs -----------------------------------------------------------

  function openCreateDialog() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEditDialog(account: CloudAccountDoc) {
    setEditing(account)
    const wsIds = account.workspaces.map((w) => (typeof w === 'string' ? w : w.id))
    const approverIds = (account.approvers || []).map((a) => (typeof a === 'string' ? a : a.id))
    setForm({
      ...EMPTY_FORM,
      name: account.name,
      provider: account.provider,
      region: account.region || '',
      workspaces: wsIds,
      approvalRequired: account.approvalRequired,
      approvers: approverIds,
      ...formFromCredentials(account.provider, account.credentials as Record<string, unknown>),
    })
    setDialogOpen(true)
  }

  // Save -------------------------------------------------------------------

  async function handleSave() {
    setSaving(true)
    try {
      const credentials = credentialsFromForm(form)

      if (editing) {
        // For updates, only send credentials if user filled them in
        const hasNewCredentials = Object.values(credentials).some(
          (v) => typeof v === 'string' && v.length > 0,
        )
        const result = await updateCloudAccount(editing.id, {
          name: form.name,
          region: form.region || undefined,
          workspaces: form.workspaces,
          approvalRequired: form.approvalRequired,
          approvers: form.approvalRequired ? form.approvers : [],
          ...(hasNewCredentials ? { credentials } : {}),
        })
        if (!result.success) throw new Error(result.error || 'Failed to update')
        toast.success('Cloud account updated')
      } else {
        const result = await createCloudAccount({
          name: form.name,
          provider: form.provider,
          credentials,
          region: form.region || undefined,
          workspaces: form.workspaces,
          approvalRequired: form.approvalRequired,
          approvers: form.approvalRequired ? form.approvers : [],
        })
        if (!result.success) throw new Error(result.error || 'Failed to create')
        toast.success('Cloud account created')
      }

      setDialogOpen(false)
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save cloud account')
    } finally {
      setSaving(false)
    }
  }

  // Delete -----------------------------------------------------------------

  async function handleDelete(account: CloudAccountDoc) {
    if (!confirm(`Are you sure you want to delete "${account.name}"?`)) return

    try {
      const result = await deleteCloudAccount(account.id)
      if (!result.success) throw new Error(result.error || 'Failed to delete')
      toast.success('Cloud account deleted')
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  // Test connection --------------------------------------------------------

  async function handleTestConnection(account: CloudAccountDoc) {
    try {
      const result = await testCloudAccountConnection(account.id)
      if (result.valid) {
        toast.success('Connection successful!')
      } else {
        toast.error(result.error || 'Connection test failed')
      }
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to test connection')
    }
  }

  // Workspace toggle for multi-select -------------------------------------

  function toggleWorkspace(id: string) {
    setForm((prev) => ({
      ...prev,
      workspaces: prev.workspaces.includes(id)
        ? prev.workspaces.filter((w) => w !== id)
        : [...prev.workspaces, id],
    }))
  }

  function toggleApprover(id: string) {
    setForm((prev) => ({
      ...prev,
      approvers: prev.approvers.includes(id)
        ? prev.approvers.filter((a) => a !== id)
        : [...prev.approvers, id],
    }))
  }

  // Render -----------------------------------------------------------------

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6" />
            Cloud Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage cloud provider accounts used for infrastructure launches
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Cloud Account
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {!error && accounts.length === 0 && (
        <Alert className="mb-4">
          <Cloud className="h-4 w-4" />
          <AlertTitle>No cloud accounts</AlertTitle>
          <AlertDescription>
            Add a cloud account to start launching infrastructure.
          </AlertDescription>
        </Alert>
      )}

      {/* Account list */}
      <div className="space-y-3">
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            onEdit={() => openEditDialog(account)}
            onDelete={() => handleDelete(account)}
            onTestConnection={() => handleTestConnection(account)}
          />
        ))}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Cloud Account' : 'Add Cloud Account'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the cloud account settings. Leave credential fields blank to keep existing values.'
                : 'Configure a cloud provider account for launching infrastructure.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Provider */}
            {!editing && (
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v: FormState['provider']) =>
                    setForm({ ...EMPTY_FORM, provider: v, name: form.name, workspaces: form.workspaces, approvalRequired: form.approvalRequired, approvers: form.approvers, region: form.region })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aws">AWS</SelectItem>
                    <SelectItem value="gcp">GCP</SelectItem>
                    <SelectItem value="azure">Azure</SelectItem>
                    <SelectItem value="digitalocean">DigitalOcean</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="ca-name">Name</Label>
              <Input
                id="ca-name"
                placeholder="e.g., Production AWS"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            {/* Provider-specific credential fields */}
            {form.provider === 'aws' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="aws-key">
                    Access Key ID {editing && '(leave blank to keep existing)'}
                  </Label>
                  <Input
                    id="aws-key"
                    placeholder={editing ? '********' : 'AKIA...'}
                    value={form.awsAccessKeyId}
                    onChange={(e) => setForm({ ...form, awsAccessKeyId: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-secret">
                    Secret Access Key {editing && '(leave blank to keep existing)'}
                  </Label>
                  <Input
                    id="aws-secret"
                    type="password"
                    placeholder={editing ? '********' : 'Enter secret key'}
                    value={form.awsSecretAccessKey}
                    onChange={(e) => setForm({ ...form, awsSecretAccessKey: e.target.value })}
                  />
                </div>
              </>
            )}

            {form.provider === 'gcp' && (
              <div className="space-y-2">
                <Label htmlFor="gcp-json">
                  Service Account JSON {editing && '(leave blank to keep existing)'}
                </Label>
                <Textarea
                  id="gcp-json"
                  rows={6}
                  className="font-mono text-xs"
                  placeholder={editing ? '(existing credentials hidden)' : '{ "type": "service_account", ... }'}
                  value={form.gcpServiceAccountJson}
                  onChange={(e) => setForm({ ...form, gcpServiceAccountJson: e.target.value })}
                />
              </div>
            )}

            {form.provider === 'azure' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="az-tenant">Tenant ID</Label>
                  <Input
                    id="az-tenant"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={form.azureTenantId}
                    onChange={(e) => setForm({ ...form, azureTenantId: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="az-client">Client ID</Label>
                  <Input
                    id="az-client"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={form.azureClientId}
                    onChange={(e) => setForm({ ...form, azureClientId: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="az-secret">
                    Client Secret {editing && '(leave blank to keep existing)'}
                  </Label>
                  <Input
                    id="az-secret"
                    type="password"
                    placeholder={editing ? '********' : 'Enter client secret'}
                    value={form.azureClientSecret}
                    onChange={(e) => setForm({ ...form, azureClientSecret: e.target.value })}
                  />
                </div>
              </>
            )}

            {form.provider === 'digitalocean' && (
              <div className="space-y-2">
                <Label htmlFor="do-token">
                  API Token {editing && '(leave blank to keep existing)'}
                </Label>
                <Input
                  id="do-token"
                  type="password"
                  placeholder={editing ? '********' : 'dop_v1_...'}
                  value={form.doApiToken}
                  onChange={(e) => setForm({ ...form, doApiToken: e.target.value })}
                />
              </div>
            )}

            {/* Region */}
            <div className="space-y-2">
              <Label htmlFor="ca-region">Default Region</Label>
              <Input
                id="ca-region"
                placeholder="e.g., us-east-1"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
              />
            </div>

            {/* Workspaces multi-select */}
            <div className="space-y-2">
              <Label>Assign to Workspaces</Label>
              <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                {workspaces.length === 0 && (
                  <p className="text-sm text-muted-foreground">No workspaces available</p>
                )}
                {workspaces.map((ws) => (
                  <label key={ws.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={form.workspaces.includes(ws.id)}
                      onCheckedChange={() => toggleWorkspace(ws.id)}
                    />
                    <span className="text-sm">{ws.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Approval required */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="ca-approval"
                checked={form.approvalRequired}
                onCheckedChange={(checked) =>
                  setForm({ ...form, approvalRequired: checked === true })
                }
              />
              <Label htmlFor="ca-approval" className="cursor-pointer">
                Require approval for launches
              </Label>
            </div>

            {/* Approvers */}
            {form.approvalRequired && (
              <div className="space-y-2">
                <Label>Approvers</Label>
                <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                  {users.length === 0 && (
                    <p className="text-sm text-muted-foreground">No users available</p>
                  )}
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.approvers.includes(u.id)}
                        onCheckedChange={() => toggleApprover(u.id)}
                      />
                      <span className="text-sm">
                        {u.name} <span className="text-muted-foreground">({u.email})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name || form.workspaces.length === 0}
            >
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Account card
// ---------------------------------------------------------------------------

function AccountCard({
  account,
  onEdit,
  onDelete,
  onTestConnection,
}: {
  account: CloudAccountDoc
  onEdit: () => void
  onDelete: () => void
  onTestConnection: () => void
}) {
  const [testing, setTesting] = useState(false)
  const meta = PROVIDER_META[account.provider] || {
    label: account.provider,
    icon: '?',
    color: 'bg-gray-100 text-gray-700',
  }
  const statusBadge = STATUS_BADGE[account.status] || STATUS_BADGE.disconnected

  const workspaceCount =
    Array.isArray(account.workspaces) ? account.workspaces.length : 0

  const workspaceNames = Array.isArray(account.workspaces)
    ? account.workspaces
        .map((w) => (typeof w === 'string' ? w : w.name))
        .join(', ')
    : ''

  async function handleTest() {
    setTesting(true)
    try {
      await onTestConnection()
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Provider icon */}
            <div
              className={`h-12 w-12 rounded-lg flex items-center justify-center font-bold text-sm ${meta.color}`}
            >
              {meta.icon}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">{account.name}</h3>
                <Badge variant="outline">{meta.label}</Badge>
                <Badge
                  variant={statusBadge.variant}
                  className={statusBadge.className || ''}
                >
                  {account.status === 'connected' && (
                    <CheckCircle className="h-3 w-3 mr-1" />
                  )}
                  {account.status === 'error' && (
                    <XCircle className="h-3 w-3 mr-1" />
                  )}
                  {account.status.charAt(0).toUpperCase() + account.status.slice(1)}
                </Badge>
                {account.approvalRequired && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Approval Required
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                <span>
                  {workspaceCount} workspace{workspaceCount !== 1 ? 's' : ''}
                  {workspaceNames && `: ${workspaceNames}`}
                </span>
                {account.region && <span>Region: {account.region}</span>}
                {account.lastValidatedAt && (
                  <span>
                    Last validated:{' '}
                    {new Date(account.lastValidatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              <Plug className="h-4 w-4 mr-1" />
              {testing ? 'Testing...' : 'Test'}
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
