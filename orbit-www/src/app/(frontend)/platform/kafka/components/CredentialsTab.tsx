'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Key, User, Copy, Check } from 'lucide-react'
import type { CredentialConfig, VirtualClusterConfig } from '@/app/actions/bifrost-admin'
import { CredentialForm } from './CredentialForm'

interface CredentialsTabProps {
  credentials: CredentialConfig[]
  virtualClusters: VirtualClusterConfig[]
  onRefresh: () => Promise<void>
  onCredentialsChange: (credentials: CredentialConfig[]) => void
}

function getTemplateBadge(template: string): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  switch (template) {
    case 'producer':
      return { label: 'Producer', variant: 'default' }
    case 'consumer':
      return { label: 'Consumer', variant: 'secondary' }
    case 'admin':
      return { label: 'Admin', variant: 'outline' }
    case 'custom':
      return { label: 'Custom', variant: 'outline' }
    default:
      return { label: template, variant: 'outline' }
  }
}

export function CredentialsTab({
  credentials,
  virtualClusters,
  onRefresh,
  onCredentialsChange: _onCredentialsChange,
}: CredentialsTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newCredential, setNewCredential] = useState<{ username: string; password: string } | null>(null)
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleRevoke = async (credentialId: string, username: string) => {
    if (!confirm(`Are you sure you want to revoke the credential for "${username}"? This will immediately disconnect any clients using this credential.`)) {
      return
    }

    try {
      const { revokeCredential } = await import('@/app/actions/bifrost-admin')
      const result = await revokeCredential(credentialId)
      if (result.success) {
        await onRefresh()
      }
    } catch (err) {
      console.error('Failed to revoke credential:', err)
    }
  }

  const handleFormSuccess = async (data: { username: string; password: string }) => {
    setNewCredential(data)
    setShowForm(false)
    await onRefresh()
  }

  const getVirtualClusterName = (vcId: string) => {
    const vc = virtualClusters.find((v) => v.id === vcId)
    return vc ? `${vc.workspaceSlug} / ${vc.environment}` : vcId
  }

  const handleCopy = async (field: 'username' | 'password', value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Show newly created credential
  if (newCredential) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Credential Created</CardTitle>
          <CardDescription>
            Save these credentials now. The password will not be shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Username</p>
              <div className="flex items-center gap-2">
                <p className="font-mono flex-1">{newCredential.username}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy('username', newCredential.username)}
                >
                  {copiedField === 'username' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Password</p>
              <div className="flex items-center gap-2">
                <p className="font-mono break-all flex-1">{newCredential.password}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy('password', newCredential.password)}
                >
                  {copiedField === 'password' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <p className="text-sm text-amber-600 dark:text-amber-500">
            This password will not be shown again. Copy and save it securely now.
          </p>
          <Button onClick={() => setNewCredential(null)}>Done</Button>
        </CardContent>
      </Card>
    )
  }

  if (showForm) {
    return (
      <CredentialForm
        virtualClusters={virtualClusters}
        onCancel={() => setShowForm(false)}
        onSuccess={handleFormSuccess}
      />
    )
  }

  // Empty state
  if (credentials.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Key className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Credentials</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          Credentials provide authentication for applications connecting through Bifrost.
          Create credentials for your virtual clusters.
        </p>
        <Button onClick={() => setShowForm(true)} disabled={virtualClusters.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Create Credential
        </Button>
        {virtualClusters.length === 0 && (
          <p className="text-sm text-muted-foreground mt-2">
            Create a virtual cluster first
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {credentials.length} credential{credentials.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)} disabled={virtualClusters.length === 0}>
            <Plus className="h-4 w-4" />
            Create Credential
          </Button>
        </div>
      </div>

      {/* Credentials grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {credentials.map((credential) => {
          const templateBadge = getTemplateBadge(credential.template)

          return (
            <Card key={credential.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{credential.username}</CardTitle>
                  </div>
                  <Badge variant={templateBadge.variant}>{templateBadge.label}</Badge>
                </div>
                <CardDescription className="text-xs">
                  {getVirtualClusterName(credential.virtualClusterId)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevoke(credential.id, credential.username)}
                  >
                    Revoke
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
