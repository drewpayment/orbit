import Link from 'next/link'
import { Compass, Gauge, Scale } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { entityKindMeta } from './entity-kind-meta'
import type { EntityTypeListItem } from '@/app/(frontend)/catalog/types/actions'

/**
 * One catalog `kind`'s definition rendered as a clickable card for the types
 * home grid (Entity Scores & Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md):
 * display name, base value, scoring weight, a golden-path summary snippet, and
 * a "Customized" vs "Default" badge showing whether a workspace row exists for
 * this kind. Links to `/catalog/types/{kind}` for the view/edit page.
 */
export function EntityTypeCard({ item }: { item: EntityTypeListItem }) {
  const meta = entityKindMeta(item.kind)
  const Icon = meta.icon

  return (
    <Link href={`/catalog/types/${item.kind}`} className="block focus:outline-none">
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className={`h-4 w-4 shrink-0 ${meta.accent}`} aria-hidden />
              <CardTitle className="truncate text-base" title={item.displayName}>
                {item.displayName}
              </CardTitle>
            </div>
            <Badge
              variant={item.isCustomized ? 'secondary' : 'outline'}
              className="shrink-0 font-normal"
            >
              {item.isCustomized ? 'Customized' : 'Default'}
            </Badge>
          </div>
          <Badge variant="outline" className="w-fit font-normal capitalize">
            {item.kind}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {item.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              Base value: <span className="font-medium text-foreground">{item.baseValue}</span>
            </span>
            <span className="flex items-center gap-1">
              <Scale className="h-3.5 w-3.5" aria-hidden />
              Weight: <span className="font-medium text-foreground">{item.scoringWeight}</span>
            </span>
          </div>
          <div className="flex items-start gap-1.5 text-xs">
            <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {item.goldenPath.summary ? (
              <span className="line-clamp-2 text-muted-foreground">{item.goldenPath.summary}</span>
            ) : (
              <span className="text-muted-foreground/70 italic">No golden path defined yet</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
