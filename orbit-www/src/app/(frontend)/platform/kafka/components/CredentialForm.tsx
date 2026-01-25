'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { VirtualClusterConfig, PermissionTemplateType } from '@/app/actions/bifrost-admin'

interface CredentialFormProps {
  virtualClusters: VirtualClusterConfig[]
  onCancel: () => void
  onSuccess: (data: { username: string; password: string }) => void
}

function generatePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

export function CredentialForm({
  virtualClusters,
  onCancel,
  onSuccess,
}: CredentialFormProps) {
  const [formData, setFormData] = useState({
    virtualClusterId: '',
    username: '',
    password: generatePassword(),
    template: 'producer' as PermissionTemplateType,
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const { createCredential } = await import('@/app/actions/bifrost-admin')
      const result = await createCredential({
        virtualClusterId: formData.virtualClusterId,
        username: formData.username,
        password: formData.password,
        template: formData.template,
      })

      if (result.success && result.data) {
        onSuccess({
          username: result.data.username,
          password: result.data.password,
        })
      } else {
        setError(result.error || 'Failed to create credential')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create credential')
    } finally {
      setIsSubmitting(false)
    }
  }

  const regeneratePassword = () => {
    setFormData({ ...formData, password: generatePassword() })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>Create Credential</CardTitle>
            <CardDescription>
              Create a new service account credential for Bifrost access
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="virtualClusterId">Virtual Cluster *</Label>
              <Select
                value={formData.virtualClusterId}
                onValueChange={(value) => setFormData({ ...formData, virtualClusterId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select virtual cluster" />
                </SelectTrigger>
                <SelectContent>
                  {virtualClusters.map((vc) => (
                    <SelectItem key={vc.id} value={vc.id}>
                      {vc.id} ({vc.workspaceSlug} / {vc.environment})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="my-service-account"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <div className="flex gap-2">
                <Input
                  id="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  className="font-mono"
                />
                <Button type="button" variant="outline" size="icon" onClick={regeneratePassword}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template">Permission Template *</Label>
              <Select
                value={formData.template}
                onValueChange={(value) => setFormData({ ...formData, template: value as PermissionTemplateType })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select permissions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="producer">Producer - Write access to topics</SelectItem>
                  <SelectItem value="consumer">Consumer - Read access to topics</SelectItem>
                  <SelectItem value="admin">Admin - Full access</SelectItem>
                  <SelectItem value="custom">Custom - Define custom permissions</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4">
            <Button type="submit" disabled={isSubmitting || !formData.virtualClusterId}>
              {isSubmitting ? 'Creating...' : 'Create Credential'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
