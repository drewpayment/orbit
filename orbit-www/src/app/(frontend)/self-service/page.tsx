import Link from 'next/link'
import {
  LayoutTemplate,
  Rocket,
  Sparkles,
  Plus,
  ArrowRight,
} from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

/**
 * Self-Service hub (IDP refocus P0).
 *
 * One surface for the ways a developer asks the platform to do something:
 * scaffold from a template, spin up infrastructure, or drive the infra agent.
 * P3 replaces these cards with a first-class Actions catalog + Action Runs
 * (durable Temporal executions) — see docs/plans/2026-06-27-idp-refocus-*.
 */

type ServiceCard = {
  title: string
  description: string
  icon: typeof Rocket
  href: string
}

const actions: ServiceCard[] = [
  {
    title: 'New Application',
    description: 'Register a new app or import an existing repository.',
    icon: Plus,
    href: '/apps/new',
  },
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

export default function SelfServicePage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">Self-Service</h1>
            <p className="text-muted-foreground mt-2">
              Golden paths and automated actions to provision what you need, safely.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <Link key={action.title} href={action.href} className="block">
                  <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <Icon className="h-6 w-6 text-muted-foreground" />
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <CardTitle className="mt-2 text-lg">{action.title}</CardTitle>
                      <CardDescription>{action.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
