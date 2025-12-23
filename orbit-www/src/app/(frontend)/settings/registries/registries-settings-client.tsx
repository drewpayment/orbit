'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Container, Plus, Trash2, Star, AlertCircle, Server, CheckCircle, Filter, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getRegistriesAndWorkspaces,
  createRegistry,
  updateRegistry,
  deleteRegistry,
  testGhcrConnection,
  testAcrConnection,
  setOrbitAsDefault,
  type RegistryConfig,
  type Workspace,
} from '@/app/actions/registries'

export function RegistriesSettingsClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const workspaceFilter = searchParams.get('workspace')

  const [registries, setRegistries] = useState<RegistryConfig[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRegistry, setEditingRegistry] = useState<RegistryConfig | null>(null)
  const [saving, setSaving] = useState(false)

  // Filter workspaces based on URL param
  const filteredWorkspaces = useMemo(() => {
    if (!workspaceFilter) return workspaces
    return workspaces.filter((ws) => ws.id === workspaceFilter || ws.slug === workspaceFilter)
  }, [workspaces, workspaceFilter])

  function setWorkspaceFilter(workspaceIdOrSlug: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (workspaceIdOrSlug) {
      params.set('workspace', workspaceIdOrSlug)
    } else {
      params.delete('workspace')
    }
    router.push(`/settings/registries?${params.toString()}`)
  }

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'ghcr' as 'ghcr' | 'acr' | 'orbit',
    workspace: '',
    isDefault: false,
    ghcrOwner: '',
    ghcrPat: '',
    acrLoginServer: '',
    acrUsername: '',
    acrToken: '',
  })

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      setLoading(true)
      setError(null)
      const result = await getRegistriesAndWorkspaces()

      if (result.error) {
        setError(result.error)
        return
      }

      setRegistries(result.registries)
      setWorkspaces(result.workspaces)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function openCreateDialog() {
    setEditingRegistry(null)
    setFormData({
      name: '',
      type: 'ghcr',
      workspace: workspaces[0]?.id || '',
      isDefault: false,
      ghcrOwner: '',
      ghcrPat: '',
      acrLoginServer: '',
      acrUsername: '',
      acrToken: '',
    })
    setDialogOpen(true)
  }

  function openEditDialog(registry: RegistryConfig) {
    setEditingRegistry(registry)
    setFormData({
      name: registry.name,
      type: registry.type,
      workspace: registry.workspace.id,
      isDefault: registry.isDefault,
      ghcrOwner: registry.ghcrOwner || '',
      ghcrPat: '', // Never pre-fill PAT
      acrLoginServer: registry.acrLoginServer || '',
      acrUsername: registry.acrUsername || '',
      acrToken: '', // Never pre-fill token
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (editingRegistry) {
        const result = await updateRegistry(editingRegistry.id, {
          name: formData.name,
          isDefault: formData.isDefault,
          ghcrOwner: formData.type === 'ghcr' ? formData.ghcrOwner : undefined,
          ghcrPat: formData.type === 'ghcr' && formData.ghcrPat ? formData.ghcrPat : undefined,
          acrLoginServer: formData.type === 'acr' ? formData.acrLoginServer : undefined,
          acrUsername: formData.type === 'acr' ? formData.acrUsername : undefined,
          acrToken: formData.type === 'acr' && formData.acrToken ? formData.acrToken : undefined,
        })

        if (!result.success) {
          throw new Error(result.error || 'Failed to update registry')
        }
      } else {
        const result = await createRegistry({
          name: formData.name,
          type: formData.type,
          workspace: formData.workspace,
          isDefault: formData.isDefault,
          ghcrOwner: formData.type === 'ghcr' ? formData.ghcrOwner : undefined,
          ghcrPat: formData.type === 'ghcr' ? formData.ghcrPat : undefined,
          acrLoginServer: formData.type === 'acr' ? formData.acrLoginServer : undefined,
          acrUsername: formData.type === 'acr' ? formData.acrUsername : undefined,
          acrToken: formData.type === 'acr' ? formData.acrToken : undefined,
        })

        if (!result.success) {
          throw new Error(result.error || 'Failed to create registry')
        }
      }

      setDialogOpen(false)
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save registry')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(registry: RegistryConfig) {
    if (!confirm(`Are you sure you want to delete "${registry.name}"?`)) {
      return
    }

    try {
      const result = await deleteRegistry(registry.id)

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete registry')
      }

      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete registry')
    }
  }

  async function handleSetDefault(registry: RegistryConfig) {
    try {
      const result = await updateRegistry(registry.id, { isDefault: true })

      if (!result.success) {
        throw new Error(result.error || 'Failed to set as default')
      }

      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to set as default')
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Container className="h-6 w-6" />
            Container Registries
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure container registries for building and pushing images
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Workspace Filter */}
          {workspaces.length > 1 && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select
                value={workspaceFilter || 'all'}
                onValueChange={(value) => setWorkspaceFilter(value === 'all' ? null : value)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Workspaces" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Workspaces</SelectItem>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.slug}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workspaceFilter && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setWorkspaceFilter(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          <Button onClick={openCreateDialog} disabled={workspaces.length === 0}>
            <Plus className="h-4 w-4 mr-2" />
            Add Registry
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {workspaces.length === 0 && !error && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Admin Access</AlertTitle>
          <AlertDescription>
            You need to be an admin or owner of a workspace to manage container registries.
          </AlertDescription>
        </Alert>
      )}

      {workspaces.length > 0 && (
        <div className="space-y-6">
          {filteredWorkspaces.length === 0 && workspaceFilter && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No workspace found</AlertTitle>
              <AlertDescription>
                No workspace matches the filter &quot;{workspaceFilter}&quot;.{' '}
                <Button variant="link" className="p-0 h-auto" onClick={() => setWorkspaceFilter(null)}>
                  Clear filter
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {filteredWorkspaces.map((workspace) => {
            const workspaceRegistries = registries.filter(
              (r) => r.workspace.id === workspace.id
            )
            const hasOrbitRegistry = workspaceRegistries.some((r) => r.type === 'orbit')
            const hasDefaultInWorkspace = workspaceRegistries.some((r) => r.isDefault)

            return (
              <div key={workspace.id} className="space-y-3">
                <h2 className="text-lg font-semibold text-muted-foreground">{workspace.name}</h2>

                {/* Built-in Orbit Registry Card (always show if no orbit registry exists) */}
                {!hasOrbitRegistry && (
                  <OrbitBuiltInCard
                    isDefault={!hasDefaultInWorkspace}
                    onSetDefault={async () => {
                      try {
                        const result = await setOrbitAsDefault(workspace.id)
                        if (!result.success) {
                          toast.error(result.error || 'Failed to set Orbit as default')
                        } else {
                          toast.success('Orbit Registry set as default')
                          fetchData()
                        }
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Failed to set Orbit as default')
                      }
                    }}
                  />
                )}

                {/* User-configured registries */}
                {workspaceRegistries.map((registry) => (
                  <RegistryCard
                    key={registry.id}
                    registry={registry}
                    onEdit={() => openEditDialog(registry)}
                    onDelete={() => handleDelete(registry)}
                    onSetDefault={() => handleSetDefault(registry)}
                    onRefresh={fetchData}
                  />
                ))}

                {workspaceRegistries.length === 0 && hasOrbitRegistry === false && (
                  <p className="text-sm text-muted-foreground pl-1">
                    Using Orbit Registry by default. Add an external registry to push to GHCR or ACR.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRegistry ? 'Edit Registry' : 'Add Container Registry'}
            </DialogTitle>
            <DialogDescription>
              Configure a container registry for building and pushing images.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Production GHCR"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {!editingRegistry && (
              <div className="space-y-2">
                <Label htmlFor="workspace">Workspace</Label>
                <Select
                  value={formData.workspace}
                  onValueChange={(value) => setFormData({ ...formData, workspace: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!editingRegistry && (
              <div className="space-y-2">
                <Label htmlFor="type">Registry Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: 'ghcr' | 'acr') => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ghcr">GitHub Container Registry (GHCR)</SelectItem>
                    <SelectItem value="acr">Azure Container Registry (ACR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.type === 'ghcr' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ghcrOwner">GitHub Owner/Organization</Label>
                  <Input
                    id="ghcrOwner"
                    placeholder="e.g., drewpayment"
                    value={formData.ghcrOwner}
                    onChange={(e) => setFormData({ ...formData, ghcrOwner: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    The GitHub user or organization that owns the container registry.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ghcrPat">
                    Personal Access Token {editingRegistry && '(leave blank to keep existing)'}
                  </Label>
                  <Input
                    id="ghcrPat"
                    type="password"
                    placeholder={editingRegistry ? '********' : 'ghp_...'}
                    value={formData.ghcrPat}
                    onChange={(e) => setFormData({ ...formData, ghcrPat: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Requires a GitHub Personal Access Token (classic) with{' '}
                    <code className="bg-muted px-1 py-0.5 rounded">write:packages</code> and{' '}
                    <code className="bg-muted px-1 py-0.5 rounded">read:packages</code> scopes.
                    Fine-grained tokens are not supported for GHCR.
                  </p>
                </div>
              </>
            )}

            {formData.type === 'acr' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="acrLoginServer">Login Server</Label>
                  <Input
                    id="acrLoginServer"
                    placeholder="e.g., myregistry.azurecr.io"
                    value={formData.acrLoginServer}
                    onChange={(e) => setFormData({ ...formData, acrLoginServer: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acrUsername">Username / Token Name</Label>
                  <Input
                    id="acrUsername"
                    placeholder="e.g., orbit-push-token"
                    value={formData.acrUsername}
                    onChange={(e) => setFormData({ ...formData, acrUsername: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acrToken">
                    Repository Token {editingRegistry && '(leave blank to keep existing)'}
                  </Label>
                  <Input
                    id="acrToken"
                    type="password"
                    placeholder={editingRegistry ? '********' : 'Enter token'}
                    value={formData.acrToken}
                    onChange={(e) => setFormData({ ...formData, acrToken: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.name || (!editingRegistry && !formData.workspace)}>
              {saving ? 'Saving...' : editingRegistry ? 'Save Changes' : 'Create Registry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RegistryCard({
  registry,
  onEdit,
  onDelete,
  onSetDefault,
  onRefresh,
}: {
  registry: RegistryConfig
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
  onRefresh: () => void
}) {
  const [testing, setTesting] = useState(false)

  async function handleTestConnection() {
    setTesting(true)
    try {
      const result = registry.type === 'ghcr'
        ? await testGhcrConnection(registry.id)
        : await testAcrConnection(registry.id)
      if (!result.success) {
        toast.error(result.error || 'Connection test failed')
      } else {
        toast.success('Connection successful!')
      }
      // Refresh data to show updated status
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to test connection')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
              <Container className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">{registry.name}</h3>
                {registry.isDefault && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    Default
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">
                  {registry.type === 'ghcr' ? 'GHCR' : registry.type === 'acr' ? 'ACR' : 'Orbit'}
                </Badge>
                {registry.type === 'ghcr' && registry.ghcrValidationStatus && (
                  <Badge
                    variant={
                      registry.ghcrValidationStatus === 'valid'
                        ? 'default'
                        : registry.ghcrValidationStatus === 'invalid'
                          ? 'destructive'
                          : 'secondary'
                    }
                    className={registry.ghcrValidationStatus === 'valid' ? 'bg-green-600' : ''}
                  >
                    {registry.ghcrValidationStatus === 'valid' && '✓ Valid'}
                    {registry.ghcrValidationStatus === 'invalid' && '✗ Invalid'}
                    {registry.ghcrValidationStatus === 'pending' && 'Not tested'}
                  </Badge>
                )}
                {registry.type === 'acr' && registry.acrValidationStatus && (
                  <Badge
                    variant={
                      registry.acrValidationStatus === 'valid'
                        ? 'default'
                        : registry.acrValidationStatus === 'invalid'
                          ? 'destructive'
                          : 'secondary'
                    }
                    className={registry.acrValidationStatus === 'valid' ? 'bg-green-600' : ''}
                  >
                    {registry.acrValidationStatus === 'valid' && '✓ Valid'}
                    {registry.acrValidationStatus === 'invalid' && '✗ Invalid'}
                    {registry.acrValidationStatus === 'pending' && 'Not tested'}
                  </Badge>
                )}
                <span>{registry.workspace.name}</span>
                {registry.type === 'ghcr' && registry.ghcrOwner && (
                  <span>ghcr.io/{registry.ghcrOwner}</span>
                )}
                {registry.type === 'acr' && registry.acrLoginServer && (
                  <span>{registry.acrLoginServer}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(registry.type === 'ghcr' || registry.type === 'acr') && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
            )}
            {!registry.isDefault && (
              <Button variant="ghost" size="sm" onClick={onSetDefault}>
                <Star className="h-4 w-4 mr-1" />
                Set Default
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onEdit}>
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

function OrbitBuiltInCard({
  isDefault,
  onSetDefault,
}: {
  isDefault: boolean
  onSetDefault: () => void
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Server className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">Orbit Registry</h3>
                <Badge variant="outline" className="text-blue-600 border-blue-600">
                  Built-in
                </Badge>
                {isDefault && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    Default
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">Orbit</Badge>
                <Badge variant="default" className="bg-green-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Always Available
                </Badge>
                <span>registry.orbit.local</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isDefault && (
              <Button variant="ghost" size="sm" onClick={onSetDefault}>
                <Star className="h-4 w-4 mr-1" />
                Set Default
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-3 pl-16">
          Push images to Orbit&apos;s built-in registry. No external credentials required.
        </p>
      </CardContent>
    </Card>
  )
}
