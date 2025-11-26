import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TemplateCatalog } from '@/components/features/templates/TemplateCatalog'

export default async function TemplatesPage() {
  const payload = await getPayload({ config })

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex-1 flex items-center justify-center">
            <Card>
              <CardHeader>
                <CardTitle>Sign in to view templates</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // Fetch templates (access control filters automatically)
  const templatesResult = await payload.find({
    collection: 'templates',
    limit: 100,
    sort: '-usageCount',
  })

  const templates = templatesResult.docs

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Template Catalog</h2>
              <p className="text-muted-foreground">
                Browse and use repository templates
              </p>
            </div>
            <Button asChild>
              <Link href="/templates/import">
                <Plus className="mr-2 h-4 w-4" />
                Import Template
              </Link>
            </Button>
          </div>

          {/* Template Catalog with Filters */}
          <TemplateCatalog templates={templates} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
