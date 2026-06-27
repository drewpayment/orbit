'use client'

import Link from 'next/link'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CatalogRelation } from '@/payload-types'
import { entityKindMeta } from './entity-kind-meta'
import {
  toEdges,
  groupEdgesByType,
  relationTypeLabel,
  type RelationEdge,
} from './entity-relations'

interface EntityRelationsProps {
  focalId: string
  relations: CatalogRelation[]
}

function NeighborRow({ edge }: { edge: RelationEdge }) {
  const meta = entityKindMeta(edge.neighbor.kind)
  const Icon = meta.icon
  return (
    <Link
      href={`/catalog/${edge.neighbor.id}`}
      className="flex items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted"
    >
      <Icon className={`h-4 w-4 shrink-0 ${meta.accent}`} />
      <span className="flex-1 truncate text-sm font-medium">{edge.neighbor.name}</span>
      <Badge variant="outline" className="shrink-0 text-xs">
        {meta.label}
      </Badge>
    </Link>
  )
}

export function EntityRelations({ focalId, relations }: EntityRelationsProps) {
  const edges = toEdges(relations, focalId)
  const groups = groupEdgesByType(edges)

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No relationships yet. Dependencies, ownership and lineage edges appear here as the
          catalog projection discovers them.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((group) => {
        const DirIcon = group.direction === 'outbound' ? ArrowRight : ArrowLeft
        return (
          <Card key={`${group.type}-${group.direction}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <DirIcon className="h-4 w-4 text-muted-foreground" />
                {relationTypeLabel(group.type)}
                <span className="text-xs font-normal text-muted-foreground">
                  ({group.direction === 'outbound' ? 'outgoing' : 'incoming'})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {group.edges.map((edge) => (
                <NeighborRow key={edge.id} edge={edge} />
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
