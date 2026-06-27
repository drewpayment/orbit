import Link from 'next/link'
import { CircleDot } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CatalogEntity } from '@/payload-types'
import { EntityKindBadge } from './EntityKindBadge'

/** Tailwind dot colour per folded-in health state. */
const HEALTH_DOT: Record<NonNullable<CatalogEntity['health']>, string> = {
  healthy: 'text-emerald-500',
  degraded: 'text-amber-500',
  down: 'text-red-500',
  unknown: 'text-muted-foreground',
}

const LIFECYCLE_VARIANT: Record<
  NonNullable<CatalogEntity['lifecycle']>,
  'default' | 'secondary' | 'outline'
> = {
  production: 'default',
  experimental: 'secondary',
  deprecated: 'outline',
}

function ownerName(owner: CatalogEntity['owner']): string | null {
  if (!owner || typeof owner === 'string') return null
  return owner.name ?? null
}

/**
 * One catalog entity rendered as a card linking to its detail page
 * (`/catalog/{id}`, owned by the detail agent). No client hooks — safe to
 * render from either a server or client parent.
 */
export function EntityListItem({ entity }: { entity: CatalogEntity }) {
  const health = entity.health ?? 'unknown'
  const owner = ownerName(entity.owner)

  return (
    <Link href={`/catalog/${entity.id}`} className="block focus:outline-none">
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate text-base" title={entity.name}>
              {entity.name}
            </CardTitle>
            <CircleDot
              className={cn('mt-0.5 h-4 w-4 shrink-0', HEALTH_DOT[health])}
              aria-label={`Health: ${health}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <EntityKindBadge kind={entity.kind} />
            {entity.lifecycle && (
              <Badge variant={LIFECYCLE_VARIANT[entity.lifecycle]} className="font-normal capitalize">
                {entity.lifecycle}
              </Badge>
            )}
            {entity.tier && (
              <Badge variant="outline" className="font-normal uppercase">
                {entity.tier.replace('-', ' ')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {entity.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{entity.description}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground/60">No description</p>
          )}
          {owner && (
            <p className="text-xs text-muted-foreground">
              Owned by <span className="font-medium text-foreground">{owner}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
