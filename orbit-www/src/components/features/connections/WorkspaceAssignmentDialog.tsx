'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateInstallationWorkspaces } from '@/app/actions/github-installations'
import { updateConnection } from '@/app/actions/git-connections'

export interface WorkspaceOption {
  id: string
  name: string
}

/** The card that opened the dialog: which record + provider to persist to. */
export interface WorkspaceDialogTarget {
  provider: 'github' | 'azure-devops'
  id: string
  /** Human label for the dialog title. */
  name: string
  allowedWorkspaceIds: string[]
}

interface WorkspaceAssignmentDialogProps {
  target: WorkspaceDialogTarget | null
  allWorkspaces: WorkspaceOption[]
  onClose: () => void
}

/**
 * Shared workspace-assignment dialog (WI2). Both GitHub installations and Azure
 * DevOps connections carry an `allowedWorkspaces` relationship; this replaces
 * the GitHub-only configure sub-page and gives ADO the
 * same capability, replacing the GitHub-only configure sub-page. Persists via
 * the provider's platform-admin-gated server action, then refreshes so the card
 * badges reflect the change.
 */
export function WorkspaceAssignmentDialog({
  target,
  allWorkspaces,
  onClose,
}: WorkspaceAssignmentDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<string[]>([])

  // Re-seed the checkboxes each time a different target opens.
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const key = target ? `${target.provider}:${target.id}` : null
  if (key && key !== initializedFor) {
    setInitializedFor(key)
    setSelected(target!.allowedWorkspaceIds)
  }
  if (!key && initializedFor) setInitializedFor(null)

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]))
  }, [])

  const onSave = useCallback(() => {
    if (!target) return
    startTransition(async () => {
      const res =
        target.provider === 'github'
          ? await updateInstallationWorkspaces(target.id, selected)
          : await updateConnection({ id: target.id, allowedWorkspaces: selected })
      if (!res.success) {
        toast.error(res.error ?? 'Failed to save workspaces')
        return
      }
      toast.success('Workspaces updated.')
      onClose()
      router.refresh()
    })
  }, [target, selected, onClose, router])

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign workspaces</DialogTitle>
          <DialogDescription>
            Choose which Orbit workspaces can use{' '}
            <span className="font-medium text-foreground">{target?.name}</span> for repository
            operations and catalog discovery.
          </DialogDescription>
        </DialogHeader>

        {allWorkspaces.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No workspaces available.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {allWorkspaces.map((ws) => (
              <label
                key={ws.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.includes(ws.id)}
                  onCheckedChange={() => toggle(ws.id)}
                />
                <span className="text-sm font-medium">{ws.name}</span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save workspaces
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
