'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ExternalLink,
  BookText,
  LayoutDashboard,
  BookOpen,
  GitBranch,
  Link2,
  Pencil,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CatalogEntity, CatalogRelation } from '@/payload-types'
import { entityKindMeta } from './entity-kind-meta'
import { EntityGraph } from './EntityGraph'
import { RelationEditor } from './RelationEditor'
import { EntityDocsTab } from './EntityDocsTab'
import { EntityScorecardsTab } from './EntityScorecardsTab'
import { ScoreNumberChip } from '@/components/features/scorecards/ScoreChip'
import {
  getEntityScoreBreakdown,
  type EntityScoreBreakdown,
  type LinkedDoc,
} from '@/app/(frontend)/catalog/[id]/actions'

interface EntityDetailProps {
  entity: CatalogEntity
  relations: CatalogRelation[]
  docs: LinkedDoc[]
  /** Whether the caller can manage this entity (edit + add/remove relations). */
  canManage: boolean
}

const lifecycleVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  experimental: 'secondary',
  production: 'default',
  deprecated: 'destructive',
}

const healthConfig: Record<string, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'bg-green-100 text-green-800' },
  degraded: { label: 'Degraded', className: 'bg-yellow-100 text-yellow-800' },
  down: { label: 'Down', className: 'bg-red-100 text-red-800' },
  unknown: { label: 'Unknown', className: 'bg-muted text-muted-foreground' },
}

const linkTypeIcon: Record<string, typeof BookText> = {
  docs: BookText,
  dashboard: LayoutDashboard,
  runbook: BookOpen,
  repository: GitBranch,
  other: Link2,
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}

export function EntityDetail({ entity, relations, docs, canManage }: EntityDetailProps) {
  const meta = entityKindMeta(entity.kind)
  const KindIcon = meta.icon

  const lifecycle = entity.lifecycle ?? null
  const health = entity.health ?? 'unknown'
  const owner = entity.owner && typeof entity.owner === 'object' ? entity.owner : null
  const links = entity.links ?? []

  // Overall entity score (Entity Scores & Golden Paths) — fetched once here
  // so it can be surfaced prominently in the header, and handed down to the
  // Scorecards tab rather than fetched a second time there. `null` means
  // "still loading"; once resolved this always holds a real breakdown, even
  // an empty one (`overall: null`), so header vs "no score" states are
  // distinguishable (see ScoreNumberChip).
  const [scoreBreakdown, setScoreBreakdown] = useState<EntityScoreBreakdown | null>(null)

  useEffect(() => {
    let active = true
    getEntityScoreBreakdown(entity.id)
      .then((data) => {
        if (active) setScoreBreakdown(data)
      })
      .catch(() => {
        if (active) {
          setScoreBreakdown({
            overall: null,
            byScorecard: {},
            baselineOnly: true,
            goldenPathSummary: null,
          })
        }
      })
    return () => {
      active = false
    }
  }, [entity.id])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to catalog
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg border bg-muted/50 p-2">
              <KindIcon className={`h-6 w-6 ${meta.accent}`} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{entity.name}</h1>
              {entity.description && (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {entity.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{meta.label}</Badge>
            {lifecycle && (
              <Badge variant={lifecycleVariant[lifecycle] ?? 'secondary'} className="capitalize">
                {lifecycle}
              </Badge>
            )}
            {entity.tier && (
              <Badge variant="outline" className="uppercase">
                {entity.tier.replace('-', ' ')}
              </Badge>
            )}
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${healthConfig[health].className}`}
            >
              {healthConfig[health].label}
            </span>
            <ScoreNumberChip
              score={scoreBreakdown === null ? undefined : (scoreBreakdown.overall?.score ?? null)}
            />
            {canManage && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/catalog/${entity.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="relations">Relations</TabsTrigger>
          <TabsTrigger value="docs">Docs</TabsTrigger>
          <TabsTrigger value="scorecards">Scorecards</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Details</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                <MetaRow label="Kind">
                  <span className="capitalize">{meta.label}</span>
                </MetaRow>
                <MetaRow label="Lifecycle">
                  <span className="capitalize">{lifecycle ?? '—'}</span>
                </MetaRow>
                <MetaRow label="Tier">
                  <span className="uppercase">{entity.tier?.replace('-', ' ') ?? '—'}</span>
                </MetaRow>
                <MetaRow label="Health">
                  <span>{healthConfig[health].label}</span>
                </MetaRow>
                <MetaRow label="Owner">
                  {owner ? (
                    <Link
                      href={`/catalog/${owner.id}`}
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {owner.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unowned</span>
                  )}
                </MetaRow>
                <MetaRow label="Source">
                  <span className="capitalize">{entity.source?.type ?? 'manual'}</span>
                </MetaRow>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Links</CardTitle>
              </CardHeader>
              <CardContent>
                {links.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No links yet — add docs, dashboards or runbooks.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {links.map((link) => {
                      const Icon = linkTypeIcon[link.type ?? 'other'] ?? Link2
                      return (
                        <a
                          key={link.id ?? link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate font-medium">{link.label}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </a>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Neighbourhood</h2>
            <EntityGraph entity={entity} relations={relations} />
          </div>
        </TabsContent>

        {/* Relations */}
        <TabsContent value="relations">
          <RelationEditor
            focalEntity={{ id: entity.id, name: entity.name, kind: entity.kind }}
            relations={relations}
            canManage={canManage}
          />
        </TabsContent>

        {/* Docs */}
        <TabsContent value="docs">
          <EntityDocsTab docs={docs} entitySlug={entity.slug} />
        </TabsContent>

        {/* Scorecards */}
        <TabsContent value="scorecards">
          <EntityScorecardsTab entityId={entity.id} breakdown={scoreBreakdown} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
