import { ShieldCheck } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

/**
 * Scorecards placeholder (IDP refocus P0).
 *
 * Operational-excellence scorecards + initiatives land in P2 — see
 * docs/plans/2026-06-27-idp-refocus-implementation.md and issue #45.
 */
export default function ScorecardsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">Scorecards</h1>
            <p className="text-muted-foreground mt-2">
              Standards enforcement, production-readiness and operational-excellence reviews.
            </p>
          </div>

          <Card className="mx-auto max-w-xl">
            <CardHeader className="items-center text-center">
              <ShieldCheck className="h-10 w-10 text-muted-foreground" />
              <CardTitle className="mt-2">Coming soon</CardTitle>
              <CardDescription>
                Scorecards let you define standards (owner set, docs linked, on approved
                pattern, health green) and score every catalog entity against maturity
                ladders, with initiatives to drive improvement.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center text-sm text-muted-foreground">
              Shipping in the operational-excellence phase of the IDP refocus.
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
