import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ArrowLeft } from 'lucide-react'
import { getTemplateDefinitionByIdOrSlug, getScaffolderApprovalGates } from '../../../run-actions'
import { getRun } from '../../../authoring-actions'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canApproveActionRun } from '@/lib/actions/authz'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TemplateRunDetail } from '@/components/features/template-authoring/TemplateRunDetail'

interface PageProps {
  // `id` (not `slug`) to match `/self-service/templates/[id]/edit`'s
  // dynamic-segment name — see the sibling run/page.tsx's PageProps comment.
  // Accepts either a definition id or its slug via
  // `getTemplateDefinitionByIdOrSlug`.
  params: Promise<{ id: string; runId: string }>
}

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/**
 * Consumer run detail entry point (Phase 2 plan Task 17). `getRun`
 * (`authoring-actions.ts`) already scopes the run to the caller's
 * workspace access (RBAC) via its own `depth: 1` findByID + gate — this
 * page adds the one check `getRun` can't make on its own: that the run's
 * `templateVersion` actually belongs to THIS `id`/slug's definition (see
 * the guard just below), so a same-workspace member can't view a run they
 * have access to under a mismatched (but still-valid-looking)
 * `[id]/run/[runId]` URL.
 */
export default async function RunDetailPage({ params }: PageProps) {
  const { id, runId } = await params

  const [definition, run] = await Promise.all([getTemplateDefinitionByIdOrSlug(id), getRun(runId)])
  if (!definition || !run) notFound()

  // Cross-id/slug guard — the counterpart to `getRun`'s `depth: 1` populate
  // of `run.templateVersion` (that's what makes
  // `run.templateVersion.definition` available here without a second
  // fetch): confirms the run's own templateVersion->definition chain
  // matches the definition resolved from the URL's `id` segment.
  const runVersionId = relId(run.templateVersion)
  const runDefinitionId =
    run.templateVersion && typeof run.templateVersion === 'object'
      ? relId(run.templateVersion.definition)
      : null
  if (!runVersionId || runDefinitionId !== definition.id) notFound()

  // Server-side approval gate for the `awaiting-approval` UI: `run.action`
  // is populated by `getRun`'s `depth: 1` findByID, so its `approvalPolicy`
  // is available here without another round trip. Threaded into
  // `TemplateRunDetail` -> `ApprovalButtons` as `canApprove` — a UI
  // affordance only; `approveRun`/`rejectRun` re-check
  // `canApproveActionRun` server-side regardless (defense in depth, not
  // the authority).
  const payload = await getPayload({ config })
  const user = await getCurrentUser()
  const payloadUser = await getPayloadUserFromSession()
  const workspaceId = relId(run.workspace)
  const approvalPolicy =
    run.action && typeof run.action === 'object' ? run.action.approvalPolicy ?? 'none' : 'none'
  const canApprove = await canApproveActionRun(
    payload,
    user?.id,
    workspaceId,
    approvalPolicy,
    isPlatformAdmin(payloadUser),
  )
  const gates = await getScaffolderApprovalGates(runId)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href={`/self-service/templates/${id}/run`}
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {definition.title ?? definition.name}
            </Link>
            <h1 className="text-3xl font-bold">Run detail</h1>
          </div>

          <TemplateRunDetail initialRun={run} getRun={getRun} canApprove={canApprove} gates={gates} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
