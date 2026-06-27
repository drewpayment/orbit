import Link from 'next/link'
import {
  Boxes,
  FileCode,
  BookOpen,
  RadioTower,
  Database,
  Network,
  Users,
  ArrowRight,
} from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

/**
 * Catalog hub (IDP refocus P0).
 *
 * Single entry surface for everything in the software catalog. For P0 this
 * unifies the *navigation* to the existing catalog-ish surfaces (Apps, APIs,
 * Kafka topics, Knowledge docs) under one roof. The unified entity graph
 * (catalog-entities + catalog-relations) lands in P1 and will replace these
 * cards with real entity-kind tabs — see docs/plans/2026-06-27-idp-refocus-*.
 */

type CatalogKind = {
  title: string
  description: string
  icon: typeof Boxes
  href?: string
  comingSoon?: boolean
}

const kinds: CatalogKind[] = [
  {
    title: 'Services & Applications',
    description: 'Apps and services registered in the portal.',
    icon: Boxes,
    href: '/apps',
  },
  {
    title: 'APIs',
    description: 'OpenAPI, GraphQL, gRPC and event schemas.',
    icon: FileCode,
    href: '/catalog/apis',
  },
  {
    title: 'Kafka Topics',
    description: 'Streaming topics, schemas and lineage.',
    icon: RadioTower,
    href: '/platform/kafka',
  },
  {
    title: 'Docs',
    description: 'Knowledge spaces and runbooks.',
    icon: BookOpen,
    href: '/knowledge',
  },
  {
    title: 'Resources & Datastores',
    description: 'Databases, caches and managed resources.',
    icon: Database,
    comingSoon: true,
  },
  {
    title: 'Domains & Systems',
    description: 'Bounded contexts grouping services and APIs.',
    icon: Network,
    comingSoon: true,
  },
  {
    title: 'Teams',
    description: 'Ownership and on-call across the catalog.',
    icon: Users,
    comingSoon: true,
  },
]

function KindCard({ kind }: { kind: CatalogKind }) {
  const Icon = kind.icon
  const body = (
    <Card
      className={
        kind.comingSoon
          ? 'h-full opacity-60'
          : 'h-full transition-colors hover:border-primary/50 hover:bg-accent/40'
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <Icon className="h-6 w-6 text-muted-foreground" />
          {kind.comingSoon ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Coming soon
            </span>
          ) : (
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <CardTitle className="mt-2 text-lg">{kind.title}</CardTitle>
        <CardDescription>{kind.description}</CardDescription>
      </CardHeader>
    </Card>
  )

  if (kind.comingSoon || !kind.href) return body
  return (
    <Link href={kind.href} className="block">
      {body}
    </Link>
  )
}

export default function CatalogPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">Catalog</h1>
            <p className="text-muted-foreground mt-2">
              Browse every service, API, topic and resource across your organization.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kinds.map((kind) => (
              <KindCard key={kind.title} kind={kind} />
            ))}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
