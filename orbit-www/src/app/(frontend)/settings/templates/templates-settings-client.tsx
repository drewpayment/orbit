'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  LayoutTemplate,
  MoreHorizontal,
  RefreshCw,
  Archive,
  Trash2,
  ExternalLink,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import {
  getAllTemplatesForAdmin,
  forceSyncTemplate,
  archiveTemplate,
  deleteTemplate,
  type AdminTemplate,
} from '@/app/actions/templates'
import { formatDistanceToNow } from 'date-fns'

const languageEmoji: Record<string, string> = {
  typescript: '🔷',
  javascript: '🟨',
  go: '🔵',
  python: '🐍',
  rust: '🦀',
  java: '☕',
  ruby: '💎',
  kubernetes: '☸️',
  terraform: '🏗️',
  ansible: '🔧',
  helm: '⎈',
  docker: '🐳',
}

const visibilityBadges = {
  workspace: { label: 'Workspace', variant: 'secondary' as const },
  shared: { label: 'Shared', variant: 'outline' as const },
  public: { label: 'Public', variant: 'default' as const },
}

const syncStatusIcons = {
  synced: <CheckCircle className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
}

export function TemplatesSettingsClient() {
  const [templates, setTemplates] = useState<AdminTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<AdminTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchTemplates()
  }, [])

  async function fetchTemplates() {
    setLoading(true)
    setError(null)
    try {
      const result = await getAllTemplatesForAdmin()
      if (result.error) {
        setError(result.error)
      } else {
        setTemplates(result.templates)
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err)
      setError('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  async function handleForceSync(template: AdminTemplate) {
    setSyncingIds((prev) => new Set(prev).add(template.id))
    try {
      const result = await forceSyncTemplate(template.id)
      if (result.success) {
        // Refresh the list to get updated sync status
        await fetchTemplates()
      } else {
        alert(`Sync failed: ${result.error}`)
      }
    } catch (err) {
      console.error('Sync failed:', err)
      alert('Sync failed')
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev)
        next.delete(template.id)
        return next
      })
    }
  }

  async function handleArchive(template: AdminTemplate) {
    try {
      const result = await archiveTemplate(template.id)
      if (result.success) {
        await fetchTemplates()
      } else {
        alert(`Archive failed: ${result.error}`)
      }
    } catch (err) {
      console.error('Archive failed:', err)
      alert('Archive failed')
    }
  }

  async function handleDelete() {
    if (!templateToDelete) return

    setDeleting(true)
    try {
      const result = await deleteTemplate(templateToDelete.id)
      if (result.success) {
        setTemplates((prev) => prev.filter((t) => t.id !== templateToDelete.id))
        setDeleteDialogOpen(false)
        setTemplateToDelete(null)
      } else {
        alert(`Delete failed: ${result.error}`)
      }
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading templates...</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutTemplate className="h-6 w-6" />
            Template Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all templates across your workspaces
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchTemplates}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Link href="/templates/import">
            <Button>Import Template</Button>
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {templates.length === 0 && !error ? (
        <Card>
          <CardHeader>
            <CardTitle>No Templates</CardTitle>
            <CardDescription>
              You don&apos;t have any templates in workspaces where you&apos;re an admin or owner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/templates/import">
              <Button>Import Your First Template</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Templates ({templates.length})</CardTitle>
            <CardDescription>
              Templates from workspaces where you&apos;re an admin or owner
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Sync Status</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => {
                  const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'
                  const isSyncing = syncingIds.has(template.id)

                  return (
                    <TableRow key={template.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{emoji}</span>
                          <div>
                            <Link
                              href={`/templates/${template.slug}`}
                              className="font-medium hover:underline"
                            >
                              {template.name}
                            </Link>
                            {template.framework && (
                              <p className="text-xs text-muted-foreground">
                                {template.framework}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/workspaces/${template.workspace.slug}`}
                          className="text-sm hover:underline"
                        >
                          {template.workspace.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={visibilityBadges[template.visibility].variant}>
                          {visibilityBadges[template.visibility].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {isSyncing ? (
                            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            syncStatusIcons[template.syncStatus as keyof typeof syncStatusIcons] ||
                            syncStatusIcons.pending
                          )}
                          {template.syncError && (
                            <span
                              className="text-xs text-red-500 max-w-[150px] truncate"
                              title={template.syncError}
                            >
                              {template.syncError}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{template.usageCount}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {template.lastSyncedAt
                            ? formatDistanceToNow(new Date(template.lastSyncedAt), {
                                addSuffix: true,
                              })
                            : 'Never'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/templates/${template.slug}`}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                View Template
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleForceSync(template)}
                              disabled={isSyncing}
                            >
                              <RefreshCw
                                className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`}
                              />
                              {isSyncing ? 'Syncing...' : 'Force Sync'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleArchive(template)}>
                              <Archive className="h-4 w-4 mr-2" />
                              Archive
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => {
                                setTemplateToDelete(template)
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{templateToDelete?.name}&quot;? This action
              cannot be undone. The template will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
