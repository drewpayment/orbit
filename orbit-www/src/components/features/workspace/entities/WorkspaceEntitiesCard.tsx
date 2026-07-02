import Link from 'next/link'
import { Boxes, Plus, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  catalogEntityHref,
  catalogNewEntityHref,
  catalogNewTeamHref,
  catalogViewAllHref,
  groupEntitiesByKind,
  hasTeamEntity,
  totalEntityCount,
  type WorkspaceEntitySummary,
} from './workspace-entities-ui'

interface WorkspaceEntitiesCardProps {
  /** The workspace's catalog entities, as plain `{ id, name, kind }` rows. */
  entities: WorkspaceEntitySummary[]
  workspaceId: string
  /**
   * Active membership in this workspace (any role) — gates the authoring
   * affordances ("New entity" / "Create team"). Non-members see a read-only
   * list. Mirrors the PM decision: create/edit = active workspace members,
   * any role (docs/plans/2026-07-02-catalog-entity-crud.md).
   */
  isMember: boolean
}

/**
 * Workspace landpage "Entities" card (Catalog Entity CRUD WP3). Lists the
 * workspace's catalog entities grouped by kind, links out to the org-wide
 * catalog, and — for active members — surfaces "New entity" plus a
 * first-class "Create team" callout when the workspace has no team entity
 * yet (the dangling `owner` relationship gap called out in the plan).
 *
 * "New entity" / "Create team" currently link to `/catalog/new` (query-param
 * prefill) rather than embedding the shared `EntityForm` in a dialog: that
 * component is owned by a parallel work package and hadn't landed on this
 * branch as of this card's implementation. Swap in an inline dialog once it
 * ships — see docs/plans/2026-07-02-catalog-entity-crud.md WP2/WP3.
 */
export function WorkspaceEntitiesCard({ entities, workspaceId, isMember }: WorkspaceEntitiesCardProps) {
  const groups = groupEntitiesByKind(entities)
  const total = totalEntityCount(groups)
  const showCreateTeamCallout = isMember && !hasTeamEntity(entities)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            <CardTitle className="text-base">Entities</CardTitle>
            {total > 0 && (
              <Badge variant="secondary" className="font-normal">
                {total}
              </Badge>
            )}
          </div>
          {isMember && (
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link href={catalogNewEntityHref(workspaceId)}>
                <Plus className="h-4 w-4 mr-1" />
                New entity
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {showCreateTeamCallout && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-dashed p-3">
            <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Create your team entity</p>
              <p className="text-xs text-muted-foreground">
                Own services, APIs, and other entities under one team.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={catalogNewTeamHref(workspaceId)}>Create team</Link>
            </Button>
          </div>
        )}

        {total === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No entities yet</p>
            {isMember && (
              <Button variant="outline" size="sm" asChild>
                <Link href={catalogNewEntityHref(workspaceId)}>Create your first entity</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.kind}>
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">{group.label}</p>
                  <Badge variant="outline" className="text-xs font-normal">
                    {group.count}
                  </Badge>
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.topEntities.map((e) => (
                    <Link
                      key={e.id}
                      href={catalogEntityHref(e.id)}
                      className="truncate rounded px-2 py-1 text-sm hover:bg-muted/50"
                    >
                      {e.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-4 mt-2 border-t text-center">
          <Button variant="link" size="sm" asChild>
            <Link href={catalogViewAllHref(workspaceId)}>View all in catalog →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
