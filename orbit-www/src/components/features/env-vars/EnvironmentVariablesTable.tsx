'use client'

import { useState, useTransition } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Badge } from '@/components/ui/badge'
import {
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import type { EnvironmentVariableDisplay } from '@/app/actions/environment-variables'
import {
  deleteEnvironmentVariable,
  revealEnvironmentVariableValue,
} from '@/app/actions/environment-variables'

interface EnvironmentVariablesTableProps {
  variables: EnvironmentVariableDisplay[]
  onEdit?: (variable: EnvironmentVariableDisplay) => void
  onCreateOverride?: (variable: EnvironmentVariableDisplay) => void
  onRefresh?: () => void
  showSource?: boolean
  isWorkspaceLevel?: boolean
}

export function EnvironmentVariablesTable({
  variables,
  onEdit,
  onCreateOverride,
  onRefresh,
  showSource = false,
  isWorkspaceLevel = true,
}: EnvironmentVariablesTableProps) {
  const [isPending, startTransition] = useTransition()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [variableToDelete, setVariableToDelete] = useState<EnvironmentVariableDisplay | null>(null)
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})

  const handleDelete = (variable: EnvironmentVariableDisplay) => {
    setVariableToDelete(variable)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (!variableToDelete) return

    startTransition(async () => {
      const result = await deleteEnvironmentVariable(variableToDelete.id)
      if (result.success) {
        toast.success(`Deleted ${variableToDelete.name}`)
        onRefresh?.()
      } else {
        toast.error(result.error || 'Failed to delete variable')
      }
      setDeleteDialogOpen(false)
      setVariableToDelete(null)
    })
  }

  const handleReveal = async (variable: EnvironmentVariableDisplay) => {
    if (revealedValues[variable.id]) {
      // Hide the value
      setRevealedValues((prev) => {
        const { [variable.id]: _, ...rest } = prev
        return rest
      })
      return
    }

    // Reveal the value
    const result = await revealEnvironmentVariableValue(variable.id)
    if (result.success && result.value) {
      setRevealedValues((prev) => ({
        ...prev,
        [variable.id]: result.value!,
      }))
    } else {
      toast.error(result.error || 'Failed to reveal value')
    }
  }

  const handleCopy = async (variable: EnvironmentVariableDisplay) => {
    const value = revealedValues[variable.id]
    if (!value) {
      // First reveal, then copy
      const result = await revealEnvironmentVariableValue(variable.id)
      if (result.success && result.value) {
        await navigator.clipboard.writeText(result.value)
        toast.success('Copied to clipboard')
      } else {
        toast.error(result.error || 'Failed to copy value')
      }
    } else {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
    }
  }

  if (variables.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No environment variables configured
      </div>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Name</TableHead>
            <TableHead className="w-[200px]">Value</TableHead>
            {showSource && <TableHead className="w-[100px]">Source</TableHead>}
            <TableHead className="w-[80px] text-center">Builds</TableHead>
            <TableHead className="w-[80px] text-center">Deploy</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variables.map((variable) => (
            <TableRow key={variable.id}>
              <TableCell className="font-mono text-sm">
                {variable.name}
                {variable.description && (
                  <span className="block text-xs text-muted-foreground font-sans">
                    {variable.description}
                  </span>
                )}
              </TableCell>
              <TableCell className="font-mono text-sm">
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[150px]">
                    {revealedValues[variable.id] || variable.maskedValue}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleReveal(variable)}
                    disabled={variable.source === 'workspace' && !isWorkspaceLevel}
                  >
                    {revealedValues[variable.id] ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </TableCell>
              {showSource && (
                <TableCell>
                  <Badge variant={variable.source === 'app' ? 'default' : 'secondary'}>
                    {variable.source === 'app' ? 'App' : 'Workspace'}
                  </Badge>
                </TableCell>
              )}
              <TableCell className="text-center">
                <Checkbox checked={variable.useInBuilds} disabled />
              </TableCell>
              <TableCell className="text-center">
                <Checkbox checked={variable.useInDeployments} disabled />
              </TableCell>
              <TableCell>
                {variable.source === 'workspace' && !isWorkspaceLevel ? (
                  // Show override button for inherited workspace variables
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCreateOverride?.(variable)}
                  >
                    Override
                  </Button>
                ) : (
                  // Show actions menu for editable variables
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleCopy(variable)}>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Value
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit?.(variable)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDelete(variable)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Environment Variable</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{variableToDelete?.name}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
