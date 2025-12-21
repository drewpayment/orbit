'use client'

import React, { useEffect, useState } from 'react'
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
import { Container, Plus, Trash2, Star, AlertCircle } from 'lucide-react'
import {
  getRegistriesAndWorkspaces,
  createRegistry,
  updateRegistry,
  deleteRegistry,
  testGhcrConnection,
  testAcrConnection,
  type RegistryConfig,
  type Workspace,
} from '@/app/actions/registries'

export function RegistriesSettingsClient() {
  const [registries, setRegistries] = useState<RegistryConfig[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRegistry, setEditingRegistry] = useState<RegistryConfig | null>(null)
  const [saving, setSaving] = useState(false)

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
        <Button onClick={openCreateDialog} disabled={workspaces.length === 0}>
          <Plus className="h-4 w-4 mr-2" />
          Add Registry
        </Button>
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

      {registries.length === 0 && workspaces.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Registries Configured</CardTitle>
            <CardDescription>
              Add a container registry to enable building and pushing images for your applications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Registry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {registries.map((registry) => (
            <RegistryCard
              key={registry.id}
              registry={registry}
              onEdit={() => openEditDialog(registry)}
              onDelete={() => handleDelete(registry)}
              onSetDefault={() => handleSetDefault(registry)}
              onRefresh={fetchData}
            />
          ))}
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
        alert(result.error || 'Connection test failed')
      } else {
        alert('Connection successful!')
      }
      // Refresh data to show updated status
      onRefresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to test connection')
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
