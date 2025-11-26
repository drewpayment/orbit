import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TemplatesSettingsClient } from './templates-settings-client'

export default async function TemplatesSettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <TemplatesSettingsClient />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
