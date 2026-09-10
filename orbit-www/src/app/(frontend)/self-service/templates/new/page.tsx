import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NewTemplateForm } from '@/components/features/template-authoring/NewTemplateForm'
import { getManageableTemplateWorkspaces } from '../editor-actions'

/**
 * New-template flow (Template Authoring Phase 2, Task 8). Resolves the
 * workspaces the caller may author in (owner/admin) for the picker, and
 * renders a not-permitted notice when they may author in none —
 * defense-in-depth on top of `createTemplateDefinition`'s own RBAC gate,
 * which is the actual enforcement point.
 *
 * Metadata only: submitting creates a draft definition plus its version-1
 * snapshot and redirects to the editor, where the real authoring happens.
 */
export default async function NewTemplatePage() {
  const workspaces = await getManageableTemplateWorkspaces()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service/templates"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Templates
            </Link>
            <h1 className="text-3xl font-bold">New template</h1>
            <p className="mt-2 text-muted-foreground">
              Name the paved path. You will author its form, steps, and output next.
            </p>
          </div>

          {workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">
                You don&rsquo;t have permission to create templates
              </h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Authoring templates requires being an owner or admin of a workspace. Ask a
                workspace owner for access.
              </p>
            </div>
          ) : (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <NewTemplateForm workspaces={workspaces} />
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
