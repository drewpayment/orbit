'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Globe,
  Lock,
  Users,
  FileCode,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { deleteAPISchema } from './actions'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APISchema = any

interface WorkspaceAPIsClientProps {
  apis: APISchema[]
  workspaceSlug: string
}

const visibilityIcons = {
  private: Lock,
  workspace: Users,
  public: Globe,
}

const statusConfig = {
  draft: { label: 'Draft', className: 'bg-yellow-100 text-yellow-800' },
  published: { label: 'Published', className: 'bg-green-100 text-green-800' },
  deprecated: { label: 'Deprecated', className: 'bg-red-100 text-red-800' },
}

export function WorkspaceAPIsClient({ apis, workspaceSlug }: WorkspaceAPIsClientProps) {
  const router = useRouter()
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [apiToDelete, setApiToDelete] = React.useState<APISchema | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  const handleDeleteClick = (api: APISchema) => {
    setApiToDelete(api)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!apiToDelete) return

    setIsDeleting(true)
    try {
      await deleteAPISchema(apiToDelete.id)
      toast.success('API deleted successfully')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete API')
    } finally {
      setIsDeleting(false)
      setDeleteDialogOpen(false)
      setApiToDelete(null)
    }
  }

  if (apis.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/50">
        <FileCode className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold">No APIs yet</h3>
        <p className="text-muted-foreground mt-1 mb-4">
          Create your first API specification to get started
        </p>
        <Button asChild>
          <Link href={`/workspaces/${workspaceSlug}/apis/new`}>
            Create API
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Endpoints</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apis.map((api) => {
              const visibility = (api.visibility || 'workspace') as 'private' | 'workspace' | 'public'
              const apiStatus = (api.status || 'draft') as 'draft' | 'published' | 'deprecated'
              const VisibilityIcon = visibilityIcons[visibility]

              return (
                <TableRow key={api.id}>
                  <TableCell>
                    <Link
                      href={`/catalog/apis/${api.id}`}
                      className="font-medium hover:underline"
                    >
                      {api.name}
                    </Link>
                    {api.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {api.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {api.currentVersion && (
                      <Badge variant="outline" className="font-mono text-xs">
                        {api.currentVersion}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusConfig[apiStatus].className}>
                      {statusConfig[apiStatus].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <VisibilityIcon className="h-4 w-4" />
                      <span className="text-xs capitalize">{visibility}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {api.endpointCount !== undefined && (
                      <span className="text-sm">{api.endpointCount}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(api.updatedAt), { addSuffix: true })}
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
                          <Link href={`/catalog/apis/${api.id}`}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/workspaces/${workspaceSlug}/apis/${api.id}`}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDeleteClick(api)}
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
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{apiToDelete?.name}&quot; and all its versions.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
