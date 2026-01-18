'use client'

import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Copy, Check, Eye, EyeOff, Plus } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export type ServiceAccountInfo = {
  id: string
  name: string
  username: string
  status: 'active' | 'revoked'
  applicationName?: string
}

interface ServiceAccountSelectorProps {
  serviceAccounts: ServiceAccountInfo[]
  applicationSlug: string
  workspaceSlug: string
  onPasswordRequest?: (accountId: string) => Promise<string | null>
}

export function ServiceAccountSelector({
  serviceAccounts,
  applicationSlug,
  workspaceSlug,
  onPasswordRequest,
}: ServiceAccountSelectorProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    serviceAccounts.length > 0 ? serviceAccounts[0].id : ''
  )
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [loadingPassword, setLoadingPassword] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const selectedAccount = serviceAccounts.find((sa) => sa.id === selectedAccountId)
  const activeAccounts = serviceAccounts.filter((sa) => sa.status === 'active')

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleLoadPassword = async () => {
    if (!onPasswordRequest || !selectedAccountId) return
    setLoadingPassword(true)
    try {
      const pwd = await onPasswordRequest(selectedAccountId)
      setPassword(pwd)
    } catch {
      toast.error('Failed to load password')
    } finally {
      setLoadingPassword(false)
    }
  }

  if (activeAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-yellow-800 dark:text-yellow-200">
              No service accounts configured
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              Create a service account to connect to this topic.
            </p>
            <Link
              href={`/workspaces/${workspaceSlug}/kafka/applications/${applicationSlug}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-yellow-800 dark:text-yellow-200 hover:underline mt-2"
            >
              <Plus className="h-4 w-4" />
              Create Service Account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Service Account</Label>
        <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a service account" />
          </SelectTrigger>
          <SelectContent>
            {activeAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                <div className="flex items-center gap-2">
                  <span>{account.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {account.status}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedAccount && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{selectedAccount.name}</span>
            <Badge
              variant="outline"
              className={
                selectedAccount.status === 'active' ? 'border-green-500 text-green-600' : ''
              }
            >
              {selectedAccount.status}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Username</Label>
            <div className="flex gap-2">
              <Input value={selectedAccount.username} readOnly className="font-mono text-sm" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(selectedAccount.username, 'username')}
              >
                {copiedField === 'username' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Password</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password || '••••••••••••••••'}
                  readOnly
                  className="font-mono text-sm pr-10"
                />
                {password && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                )}
              </div>
              {password ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(password, 'password')}
                >
                  {copiedField === 'password' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleLoadPassword}
                  disabled={loadingPassword || !onPasswordRequest}
                >
                  {loadingPassword ? 'Loading...' : 'Show'}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Password is only shown once. Store it securely.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href={`/workspaces/${workspaceSlug}/kafka/applications/${applicationSlug}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Manage service accounts
        </Link>
      </div>
    </div>
  )
}
