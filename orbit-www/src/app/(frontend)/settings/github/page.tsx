import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { GitHubSettingsClient } from './github-settings-client'

export default async function GitHubSettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <GitHubSettingsClient />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
