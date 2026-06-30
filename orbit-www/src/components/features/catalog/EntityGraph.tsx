'use client'

import Link from 'next/link'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import type { CatalogEntity, CatalogRelation } from '@/payload-types'
import { entityKindMeta } from './entity-kind-meta'
import { toEdges, groupEdgesByType, relationTypeLabel } from './entity-relations'

interface EntityGraphProps {
  entity: CatalogEntity
  relations: CatalogRelation[]
}

/**
 * Lightweight, dependency-free depth-1 neighbour graph: the focal entity sits on
 * the left as the center node, with one labelled branch per relation-type group
 * fanning out to its neighbour chips. Edges are labelled with the relation type
 * and a direction arrow (→ outgoing, ← incoming). Intentionally CSS-only — no
 * graph library — since we only ever render immediate neighbours.
 */
export function EntityGraph({ entity, relations }: EntityGraphProps) {
  const edges = toEdges(relations, entity.id)
  const groups = groupEdgesByType(edges)

  const FocalIcon = entityKindMeta(entity.kind).icon
  const focalAccent = entityKindMeta(entity.kind).accent

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No neighbours to graph yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4">
      <div className="flex items-stretch gap-4">
        {/* Center node */}
        <div className="flex shrink-0 items-center">
          <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3 shadow-sm">
            <FocalIcon className={`h-5 w-5 ${focalAccent}`} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{entity.name}</div>
              <div className="text-xs capitalize text-muted-foreground">
                {entityKindMeta(entity.kind).label}
              </div>
            </div>
          </div>
        </div>

        {/* Branches */}
        <div className="flex flex-1 flex-col justify-center gap-3">
          {groups.map((group) => {
            const DirIcon = group.direction === 'outbound' ? ArrowRight : ArrowLeft
            return (
              <div
                key={`${group.type}-${group.direction}`}
                className="flex items-center gap-3"
              >
                {/* Labelled connector */}
                <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <span aria-hidden className="h-px w-4 bg-border" />
                  <DirIcon className="h-3.5 w-3.5" />
                  <span className="whitespace-nowrap font-medium">
                    {relationTypeLabel(group.type)}
                  </span>
                  <span aria-hidden className="h-px w-4 bg-border" />
                </div>
                {/* Neighbour chips */}
                <div className="flex flex-wrap gap-2">
                  {group.edges.map((edge) => {
                    const meta = entityKindMeta(edge.neighbor.kind)
                    const Icon = meta.icon
                    return (
                      <Link
                        key={edge.id}
                        href={`/catalog/${edge.neighbor.id}`}
                        className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-muted"
                      >
                        <Icon className={`h-3.5 w-3.5 ${meta.accent}`} />
                        <span className="max-w-[12rem] truncate">{edge.neighbor.name}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
