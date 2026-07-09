'use client'

import { Github, Server } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { githubInstallUrl } from '@/lib/github/install-url'

interface AddConnectionDialogProps {
  open: boolean
  onClose: () => void
  /** Selecting Azure DevOps hands off to the ADO create dialog. */
  onSelectAzureDevOps: () => void
}

/**
 * Provider picker for "Add connection". GitHub hands off to the external
 * GitHub App install redirect (state token preserved in sessionStorage until
 * WI4 moves it server-side); Azure DevOps opens the in-app credential dialog.
 * New providers slot in here as additional options.
 */
export function AddConnectionDialog({
  open,
  onClose,
  onSelectAzureDevOps,
}: AddConnectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a connection</DialogTitle>
          <DialogDescription>
            Connect a git provider to import repositories and run catalog discovery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <a
            href={githubInstallUrl()}
            className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
          >
            <div className="rounded-md border p-2">
              <Github className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">GitHub</p>
              <p className="text-sm text-muted-foreground">
                Install the Orbit GitHub App into an organization.
              </p>
            </div>
          </a>

          <button
            type="button"
            onClick={() => {
              onClose()
              onSelectAzureDevOps()
            }}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
          >
            <div className="rounded-md border p-2">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Azure DevOps</p>
              <p className="text-sm text-muted-foreground">
                Connect an organization with a service principal or PAT.
              </p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
