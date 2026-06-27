import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { canManageActions } from '@/lib/actions/authz'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm } from '@/components/features/actions/ActionForm'
import { DeleteActionButton } from '@/components/features/actions/DeleteActionButton'
import { parseInputSchemaToBuilderFields } from '@/components/features/actions/input-schema-builder'
import type { Action } from '@/payload-types'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Edit an existing self-service Action (IDP refocus P3). Loads the action,
 * resolves manageability server-side (owner/admin of the action's workspace),
 * and 404s when the action is missing or the user may not manage it — so the
 * form (and its server-enforced mutations) only ever render for authorized
 * authors. Workspace is fixed and not editable here.
 */
export default async function EditActionPage({ params }: PageProps) {
  const { id } = await params
  const user = await getCurrentUser()
  const payload = await getPayload({ config })

  let action: Action
  try {
    action = await payload.findByID({
      collection: 'actions',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    notFound()
  }

  const workspaceId =
    typeof action.workspace === 'string' ? action.workspace : action.workspace?.id
  const canManage = await canManageActions(payload, user?.id, workspaceId)
  if (!canManage) notFound()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Self-Service
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">Edit action</h1>
                <p className="mt-2 text-muted-foreground">{action.name}</p>
              </div>
              <DeleteActionButton actionId={action.id} actionName={action.name} />
            </div>
          </div>

          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                mode="edit"
                actionId={action.id}
                initial={{
                  name: action.name,
                  description: action.description,
                  icon: action.icon,
                  approvalPolicy: action.approvalPolicy ?? 'none',
                  backend: {
                    type: action.backend.type,
                    ref: action.backend.ref ?? '',
                  },
                  fields: parseInputSchemaToBuilderFields(action.inputSchema),
                  enabled: action.enabled ?? true,
                }}
              />
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
