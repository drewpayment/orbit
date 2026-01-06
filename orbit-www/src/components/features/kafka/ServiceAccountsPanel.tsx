'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Plus, RefreshCw, MoreHorizontal, Key, Ban, Copy, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  listServiceAccounts,
  rotateServiceAccountPassword,
  revokeServiceAccount,
  ServiceAccountData,
} from '@/app/actions/kafka-service-accounts'
import { CreateServiceAccountDialog } from './CreateServiceAccountDialog'

interface ServiceAccountsPanelProps {
  virtualClusterId: string
  applicationId: string
  environment: string
}

const templateLabels: Record<string, string> = {
  producer: 'Producer',
  consumer: 'Consumer',
  admin: 'Admin',
  custom: 'Custom',
}

const templateColors: Record<string, string> = {
  producer: 'bg-blue-100 text-blue-700',
  consumer: 'bg-green-100 text-green-700',
  admin: 'bg-purple-100 text-purple-700',
  custom: 'bg-gray-100 text-gray-700',
}

export function ServiceAccountsPanel({
  virtualClusterId,
  applicationId,
  environment,
}: ServiceAccountsPanelProps) {
  const [accounts, setAccounts] = useState<ServiceAccountData[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<ServiceAccountData | null>(null)
  const [newPassword, setNewPassword] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listServiceAccounts({ virtualClusterId })
      if (result.success && result.serviceAccounts) {
        setAccounts(result.serviceAccounts)
      } else {
        toast.error(result.error || 'Failed to load service accounts')
      }
    } catch {
      toast.error('Failed to load service accounts')
    } finally {
      setLoading(false)
    }
  }, [virtualClusterId])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleCreateSuccess = (password: string) => {
    setCreateDialogOpen(false)
    setNewPassword(password)
    loadAccounts()
    toast.success('Service account created')
  }

  const handleRotate = async () => {
    if (!selectedAccount) return

    const result = await rotateServiceAccountPassword(selectedAccount.id)
    if (result.success && result.password) {
      setNewPassword(result.password)
      toast.success('Password rotated successfully')
      loadAccounts()
    } else {
      toast.error(result.error || 'Failed to rotate password')
    }
    setRotateDialogOpen(false)
    setSelectedAccount(null)
  }

  const handleRevoke = async () => {
    if (!selectedAccount) return

    const result = await revokeServiceAccount(selectedAccount.id)
    if (result.success) {
      toast.success('Service account revoked')
      loadAccounts()
    } else {
      toast.error(result.error || 'Failed to revoke service account')
    }
    setRevokeDialogOpen(false)
    setSelectedAccount(null)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Service Accounts</CardTitle>
              <CardDescription>
                Credentials for authenticating to this virtual cluster
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadAccounts} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Create
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No service accounts yet. Create one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-1 py-0.5 rounded">
                        {account.username}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-1 h-6 w-6 p-0"
                        onClick={() => copyToClipboard(account.username)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Badge className={templateColors[account.permissionTemplate]}>
                        {templateLabels[account.permissionTemplate]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {account.status === 'active' ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-700">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-red-100 text-red-700">
                          <XCircle className="h-3 w-3 mr-1" />
                          Revoked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={account.status === 'revoked'}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedAccount(account)
                              setRotateDialogOpen(true)
                            }}
                          >
                            <Key className="h-4 w-4 mr-2" />
                            Rotate Password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              setSelectedAccount(account)
                              setRevokeDialogOpen(true)
                            }}
                          >
                            <Ban className="h-4 w-4 mr-2" />
                            Revoke
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Password Display Dialog */}
      {newPassword && (
        <AlertDialog open={!!newPassword} onOpenChange={() => setNewPassword(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Save Your Password</AlertDialogTitle>
              <AlertDialogDescription>
                This password will only be shown once. Copy it now and store it securely.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="my-4">
              <code className="block p-3 bg-muted rounded text-sm break-all">{newPassword}</code>
            </div>
            <AlertDialogFooter>
              <Button onClick={() => copyToClipboard(newPassword)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Password
              </Button>
              <AlertDialogAction onClick={() => setNewPassword(null)}>Done</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Rotate Confirmation Dialog */}
      <AlertDialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate Password</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a new password for &quot;{selectedAccount?.name}&quot;. The old
              password will immediately stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRotate}>Rotate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Service Account</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke &quot;{selectedAccount?.name}&quot;. All clients using
              this account will lose access immediately. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-red-600 hover:bg-red-700">
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateServiceAccountDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        applicationId={applicationId}
        virtualClusterId={virtualClusterId}
        environment={environment}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}
