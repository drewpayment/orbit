import Link from 'next/link'
import { Plug, Container, LayoutTemplate, Cloud } from 'lucide-react'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { isFeatureEnabled, type PreviewFeatureKey } from '@/lib/features'

// Preview-feature gate reads the runtime env var, so never prerender at build time.
export const dynamic = 'force-dynamic'

const settingsItems: {
  title: string
  description: string
  href: string
  icon: typeof Plug
  feature?: PreviewFeatureKey
}[] = [
  {
    title: 'Connections',
    description: 'Connect GitHub and Azure DevOps for repository import and catalog discovery.',
    href: '/settings/connections',
    icon: Plug,
  },
  {
    title: 'Registries',
    description: 'Configure container registries for building and deploying applications.',
    href: '/settings/registries',
    icon: Container,
  },
  {
    title: 'Templates',
    description: 'Manage application templates and scaffolding configurations.',
    href: '/settings/templates',
    icon: LayoutTemplate,
    feature: 'legacyTemplates',
  },
  {
    title: 'Cloud Accounts',
    description: 'Connect cloud provider accounts for infrastructure provisioning.',
    href: '/settings/cloud-accounts',
    icon: Cloud,
  },
]

export default function SettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Manage integrations, registries, and platform configuration.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {settingsItems.filter((item) => !item.feature || isFeatureEnabled(item.feature)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="rounded-md border p-2 group-hover:bg-background">
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h2 className="font-medium">{item.title}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {item.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
