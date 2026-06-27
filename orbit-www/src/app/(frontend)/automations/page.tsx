import { Zap } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

/**
 * Automations placeholder (IDP refocus P0).
 *
 * Event-driven automation + drift detection land in P4 — see
 * docs/plans/2026-06-27-idp-refocus-implementation.md.
 */
export default function AutomationsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">Automations</h1>
            <p className="text-muted-foreground mt-2">
              Event-driven rules that react to catalog and scorecard changes.
            </p>
          </div>

          <Card className="mx-auto max-w-xl">
            <CardHeader className="items-center text-center">
              <Zap className="h-10 w-10 text-muted-foreground" />
              <CardTitle className="mt-2">Coming soon</CardTitle>
              <CardDescription>
                Automations trigger self-service actions when something changes — for
                example, opening a remediation action when a service drifts out of
                scorecard compliance.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center text-sm text-muted-foreground">
              Shipping in the automation phase of the IDP refocus.
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
