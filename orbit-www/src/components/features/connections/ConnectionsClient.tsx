'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Github, Plus, Server, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AdminConnectionView } from '@/lib/connections/connections-core'
import type { AdminInstallationView } from '@/lib/github/installations-core'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { AzureDevOpsConnectionCard } from './AzureDevOpsConnectionCard'
import { AddConnectionDialog } from './AddConnectionDialog'
import { ConnectionDialog, type ConnectionDialogState } from './ConnectionDialog'
import {
  WorkspaceAssignmentDialog,
  type WorkspaceDialogTarget,
  type WorkspaceOption,
} from './WorkspaceAssignmentDialog'

// Maps the install-callback's `?error=` code (WI4) to a user-facing message.
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'The GitHub install link could not be verified. Please try connecting again.',
  unauthorized: 'You must be signed in as a platform admin to connect GitHub.',
}

/** Surfaces the install-callback's `?error=` query param as a toast, then strips it from the URL. */
function ConnectionsCallbackError() {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const error = searchParams.get('error')
    if (!error) return
    toast.error(
      CALLBACK_ERROR_MESSAGES[error] ??
        'Something went wrong connecting to GitHub. Please try again.',
    )
    const params = new URLSearchParams(searchParams)
    params.delete('error')
    router.replace(params.size ? `/settings/connections?${params}` : '/settings/connections')
  }, [searchParams, router])

  return null
}

interface ConnectionsClientProps {
  installations: AdminInstallationView[]
  connections: AdminConnectionView[]
  workspaces: WorkspaceOption[]
}

/**
 * Unified Platform Admin "Connections" surface. Presents every git-provider
 * connection in provider sections (GitHub first, then Azure DevOps) with one
 * Add flow, consistent card verbs (Check health / Scan / Workspaces / Remove),
 * and workspace assignment for both providers. The GitHub / Azure DevOps
 * data-model split stays; this is a presentation-layer consolidation.
 */
export function ConnectionsClient({
  installations,
  connections,
  workspaces,
}: ConnectionsClientProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [adoDialog, setAdoDialog] = useState<ConnectionDialogState>(null)
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceDialogTarget | null>(null)

  const isEmpty = installations.length === 0 && connections.length === 0

  return (
    <>
      <Suspense fallback={null}>
        <ConnectionsCallbackError />
      </Suspense>

      <Header onAdd={() => setAddOpen(true)} />

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Unplug className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No connections yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Connect GitHub or Azure DevOps to import repositories and run catalog discovery across
            your workspaces.
          </p>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add connection
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {installations.length > 0 && (
            <ProviderSection title="GitHub" icon={<Github className="h-5 w-5" />}>
              {installations.map((inst) => (
                <GitHubConnectionCard
                  key={inst.id}
                  installation={inst}
                  onWorkspaces={setWorkspaceTarget}
                />
              ))}
            </ProviderSection>
          )}

          {connections.length > 0 && (
            <ProviderSection title="Azure DevOps" icon={<Server className="h-5 w-5" />}>
              {connections.map((c) => (
                <AzureDevOpsConnectionCard
                  key={c.id}
                  connection={c}
                  onEdit={() => setAdoDialog({ mode: 'edit', connection: c })}
                  onWorkspaces={setWorkspaceTarget}
                />
              ))}
            </ProviderSection>
          )}
        </div>
      )}

      <AddConnectionDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSelectAzureDevOps={() => setAdoDialog({ mode: 'create' })}
      />
      <ConnectionDialog state={adoDialog} onClose={() => setAdoDialog(null)} />
      <WorkspaceAssignmentDialog
        target={workspaceTarget}
        allWorkspaces={workspaces}
        onClose={() => setWorkspaceTarget(null)}
      />
    </>
  )
}

function Header({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connect GitHub and Azure DevOps to import repositories and run catalog discovery.
        </p>
      </div>
      <Button onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" /> Add connection
      </Button>
    </div>
  )
}

function ProviderSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
