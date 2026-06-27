import {
  Boxes,
  FileCode,
  Package,
  Database,
  RadioTower,
  Network,
  Layers,
  Users,
  Globe,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { KIND_LABELS_SINGULAR, type EntityKind } from './catalog-query'

/**
 * Kind → lucide icon map. Owned by this file (no shared barrel) so the list and
 * detail surfaces can each pick their own icon source without coupling.
 */
const KIND_ICONS: Record<EntityKind, LucideIcon> = {
  service: Boxes,
  api: FileCode,
  resource: Package,
  datastore: Database,
  'kafka-topic': RadioTower,
  domain: Network,
  system: Layers,
  team: Users,
  environment: Globe,
}

/** Resolve the icon component for a kind (falls back to Boxes for safety). */
export function kindIcon(kind: EntityKind): LucideIcon {
  return KIND_ICONS[kind] ?? Boxes
}

export function EntityKindBadge({
  kind,
  className,
}: {
  kind: EntityKind
  className?: string
}) {
  const Icon = kindIcon(kind)
  return (
    <Badge variant="secondary" className={cn('gap-1 font-normal', className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {KIND_LABELS_SINGULAR[kind]}
    </Badge>
  )
}
