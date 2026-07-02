import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EntityTypeForm } from '@/components/features/catalog/EntityTypeForm'
import { entityKindMeta } from '@/components/features/catalog/entity-kind-meta'
import { getEntityTypeDetail } from '../actions'

interface PageProps {
  params: Promise<{ kind: string }>
}

/**
 * Per-kind entity-type definition (Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md): a read view for
 * every workspace member, and an editable form for owner/admin. `notFound()`
 * on an unrecognised `kind` or no workspace access — `getEntityTypeDetail`
 * returns `null` for both (see `catalog/types/actions.ts`).
 */
export default async function EntityTypeDetailPage({ params }: PageProps) {
  const { kind } = await params
  const user = await getCurrentUser()
  const detail = await getEntityTypeDetail(user?.id, kind)
  if (!detail) notFound()

  const { definition, canManage, isCustomized } = detail
  const meta = entityKindMeta(definition.kind)
  const Icon = meta.icon

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/catalog/types"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Entity types
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-6 w-6 ${meta.accent}`} aria-hidden />
                  <h1 className="text-3xl font-bold">{definition.displayName}</h1>
                </div>
                {definition.description && (
                  <p className="max-w-2xl text-muted-foreground">{definition.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="font-normal capitalize">
                    {definition.kind}
                  </Badge>
                  <Badge variant={isCustomized ? 'secondary' : 'outline'} className="font-normal">
                    {isCustomized ? 'Customized' : 'Default'}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Base value</span>
                  <span className="font-medium">{definition.baseValue}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Scoring weight</span>
                  <span className="font-medium">{definition.scoringWeight}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Golden path</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {definition.goldenPath.summary ? (
                  <p>{definition.goldenPath.summary}</p>
                ) : (
                  <p className="text-muted-foreground italic">No golden path defined yet.</p>
                )}
                {definition.goldenPath.docsUrl && (
                  <a
                    href={definition.goldenPath.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    {definition.goldenPath.docsUrl}
                  </a>
                )}
              </CardContent>
            </Card>
          </div>

          {(definition.goldenPath.requiredRelations.length > 0 ||
            definition.goldenPath.requiredMetadata.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Structural expectations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {definition.goldenPath.requiredRelations.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Required relations</p>
                    <ul className="space-y-1">
                      {definition.goldenPath.requiredRelations.map((r, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="font-normal">
                            {r.relationType}
                          </Badge>
                          <span className="text-muted-foreground">{r.direction}</span>
                          {r.targetKind && (
                            <Badge variant="outline" className="font-normal capitalize">
                              {r.targetKind}
                            </Badge>
                          )}
                          <span className="text-muted-foreground">min {r.min}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {definition.goldenPath.requiredMetadata.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Required metadata</p>
                    <ul className="space-y-1">
                      {definition.goldenPath.requiredMetadata.map((m, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{m.path}</code>
                          {m.label && <span className="text-muted-foreground">{m.label}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Edit definition</CardTitle>
              </CardHeader>
              <CardContent>
                <EntityTypeForm kind={definition.kind} initial={definition} />
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <ShieldAlert className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Editing this definition requires being an owner or admin of this workspace.
              </p>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
