import { PackageOpen } from 'lucide-react'
import type { CatalogEntity } from '@/payload-types'
import { EntityListItem } from './EntityListItem'

/**
 * Grid of catalog entities with a friendly empty state. Stateless — the parent
 * client owns filters and pagination.
 */
export function EntityList({
  entities,
  emptyTitle = 'No entities found',
  emptyHint,
}: {
  entities: CatalogEntity[]
  emptyTitle?: string
  emptyHint?: string
}) {
  if (entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <PackageOpen className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">{emptyTitle}</h3>
        {emptyHint && <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {entities.map((entity) => (
        <EntityListItem key={entity.id} entity={entity} />
      ))}
    </div>
  )
}
