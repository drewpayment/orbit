import { Suspense } from 'react'
import Link from 'next/link'
import {
  Loader2,
  Plus,
  Zap,
  ScrollText,
  LayoutTemplate,
  Rocket,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ActionCard } from '@/components/features/actions/ActionCard'
import { listActions, getManageableActionWorkspaces } from './actions'

/**
 * Self-Service Actions catalog (IDP refocus P3, Port's "Action" model).
 *
 * Replaces the P0 static hub: the primary content is now the workspace's
 * defined Actions (run via the {@link ActionCard} → run dialog), with the
 * deferred backend entry points (templates, launches, infra agent) preserved
 * as secondary cards. "Runs" links to the durable Action Run history.
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P3).
 */

type BackendCard = {
  title: string
  description: string
  icon: typeof Rocket
  href: string
}

// Deferred Temporal/agent backends — kept as quick links beneath the catalog.
const backendCards: BackendCard[] = [
  {
    title: 'Templates',
    description: 'Scaffold a new repository from a golden-path template.',
    icon: LayoutTemplate,
    href: '/templates',
  },
  {
    title: 'Launches',
    description: 'Provision cloud infrastructure (Azure, DigitalOcean).',
    icon: Rocket,
    href: '/launches',
  },
  {
    title: 'Infra Agent',
    description: 'Drive governed infrastructure changes with human-in-the-loop approval.',
    icon: Sparkles,
    href: '/agent',
  },
]

async function ActionsCatalog() {
  const user = await getCurrentUser()
  const actions = await listActions(user?.id)

  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Zap className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">No actions yet</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Actions are the self-service things developers can run — scaffold a service, provision a
          topic, or drive the infra agent. Define one to populate the catalog.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {actions.map((action) => (
        <ActionCard key={action.id} action={action} />
      ))}
    </div>
  )
}

/**
 * "New action" CTA — rendered only when the user can author Actions in at least
 * one workspace (matches the authoring RBAC gate). Streams in its own Suspense
 * boundary so resolving manageable workspaces never blocks the page header.
 */
async function NewActionButton() {
  const user = await getCurrentUser()
  const workspaces = await getManageableActionWorkspaces(user?.id)
  if (workspaces.length === 0) return null
  return (
    <Button asChild size="sm">
      <Link href="/self-service/new">
        <Plus className="h-4 w-4" />
        New action
      </Link>
    </Button>
  )
}

export default function SelfServicePage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-8 p-8 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Self-Service</h1>
              <p className="mt-2 text-muted-foreground">
                Actions developers can run to provision what they need, safely.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/self-service/runs">
                  <ScrollText className="h-4 w-4" />
                  Runs
                </Link>
              </Button>
              <Suspense fallback={null}>
                <NewActionButton />
              </Suspense>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ActionsCatalog />
          </Suspense>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">More ways to provision</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {backendCards.map((card) => {
                const Icon = card.icon
                return (
                  <Link key={card.title} href={card.href} className="block">
                    <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <Icon className="h-6 w-6 text-muted-foreground" />
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <CardTitle className="mt-2 text-lg">{card.title}</CardTitle>
                        <CardDescription>{card.description}</CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
