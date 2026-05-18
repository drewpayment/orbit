import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

import { NewLLMProviderForm } from './new-llm-provider-form'

export const metadata = {
  title: 'New LLM Provider — Platform Admin',
}

export default async function NewLLMProviderPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) redirect('/')

  const payload = await getPayload({ config })
  const workspaces = await payload.find({
    collection: 'workspaces',
    sort: 'name',
    limit: 200,
    overrideAccess: true,
  })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="container mx-auto py-8 px-6 max-w-3xl space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">New LLM Provider</h1>
            <Button asChild variant="outline">
              <Link href="/platform/llm-providers">Cancel</Link>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Provider details</CardTitle>
              <CardDescription>
                The Infrastructure Agent worker uses these credentials to drive an LLM
                conversation loop. The API key is encrypted at rest and only exposed to the
                temporal worker through an internal-only API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NewLLMProviderForm
                workspaces={workspaces.docs.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
              />
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
