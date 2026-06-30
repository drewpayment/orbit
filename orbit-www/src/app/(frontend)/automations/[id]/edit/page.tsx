import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AutomationForm } from '@/components/features/automations/AutomationForm'
import { DeleteAutomationButton } from '@/components/features/automations/DeleteAutomationButton'
import { getAutomationForEdit } from '../../actions'

/**
 * Edit-automation flow (IDP refocus P4). Loads the automation only if the user
 * may manage its workspace (the loader returns null otherwise → 404), so this
 * page is itself an authorization boundary on top of the server action.
 */
export default async function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  const automation = await getAutomationForEdit(user?.id, id)
  if (!automation) notFound()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link
                href="/automations"
                className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Automations
              </Link>
              <h1 className="text-3xl font-bold">Edit automation</h1>
            </div>
            <DeleteAutomationButton automationId={automation.id} automationName={automation.name} />
          </div>

          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <AutomationForm
                mode="edit"
                automationId={automation.id}
                initial={{
                  name: automation.name,
                  description: automation.description,
                  event: automation.event,
                  filter: automation.filter,
                  schedule: automation.schedule,
                  actionId: automation.actionId,
                  inputMapping: automation.inputMapping,
                  enabled: automation.enabled,
                  actions: automation.actions,
                }}
              />
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
