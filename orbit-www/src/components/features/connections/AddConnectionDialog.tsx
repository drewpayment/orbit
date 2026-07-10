'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Github, Loader2, Server } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createGithubInstallUrl } from '@/app/actions/github-install'

interface AddConnectionDialogProps {
  open: boolean
  onClose: () => void
  /** Selecting Azure DevOps hands off to the ADO create dialog. */
  onSelectAzureDevOps: () => void
}

/**
 * Provider picker for "Add connection". GitHub mints a server-issued CSRF
 * state token (cookie-backed, see WI4 / app/actions/github-install.ts) before
 * navigating to the GitHub App install redirect; Azure DevOps opens the
 * in-app credential dialog. New providers slot in here as additional options.
 */
export function AddConnectionDialog({
  open,
  onClose,
  onSelectAzureDevOps,
}: AddConnectionDialogProps) {
  const [connecting, startConnecting] = useTransition()

  const onSelectGitHub = () => {
    startConnecting(async () => {
      const res = await createGithubInstallUrl()
      if (!res.success || !res.url) {
        toast.error(res.error ?? 'Failed to start the GitHub install flow')
        return
      }
      window.location.href = res.url
    })
  }

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
          <button
            type="button"
            onClick={onSelectGitHub}
            disabled={connecting}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="rounded-md border p-2">
              {connecting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Github className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="font-medium">GitHub</p>
              <p className="text-sm text-muted-foreground">
                Install the Orbit GitHub App into an organization.
              </p>
            </div>
          </button>

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
