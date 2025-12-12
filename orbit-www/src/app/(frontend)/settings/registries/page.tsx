import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { RegistriesSettingsClient } from './registries-settings-client'

export default function RegistriesSettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <RegistriesSettingsClient />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
