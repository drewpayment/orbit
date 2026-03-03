import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { CloudAccountsSettingsClient } from './cloud-accounts-settings-client'

export default function CloudAccountsSettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <CloudAccountsSettingsClient />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
