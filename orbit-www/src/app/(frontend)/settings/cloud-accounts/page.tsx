import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { CloudAccountsSettingsClient } from './cloud-accounts-settings-client'
import { isFeatureEnabled } from '@/lib/features'

// Reads the runtime preview-feature env var.
export const dynamic = 'force-dynamic'

export default function CloudAccountsSettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <CloudAccountsSettingsClient showDigitalOcean={isFeatureEnabled('digitalOceanLaunches')} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
