import {
  Box,
  Boxes,
  Cloud,
  Database,
  Layers,
  Network,
  Radio,
  Server,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { CatalogEntity } from '@/payload-types'

export type EntityKind = CatalogEntity['kind']

/**
 * Local presentation map for catalog entity kinds (icon + label + accent).
 * Deliberately self-contained so this detail UI doesn't depend on sibling
 * catalog components owned by other agents.
 */
export const ENTITY_KIND_META: Record<EntityKind, { icon: LucideIcon; label: string; accent: string }> = {
  service: { icon: Server, label: 'Service', accent: 'text-blue-600' },
  api: { icon: Network, label: 'API', accent: 'text-violet-600' },
  resource: { icon: Box, label: 'Resource', accent: 'text-amber-600' },
  datastore: { icon: Database, label: 'Datastore', accent: 'text-emerald-600' },
  'kafka-topic': { icon: Radio, label: 'Kafka Topic', accent: 'text-orange-600' },
  domain: { icon: Layers, label: 'Domain', accent: 'text-indigo-600' },
  system: { icon: Boxes, label: 'System', accent: 'text-cyan-600' },
  team: { icon: Users, label: 'Team', accent: 'text-pink-600' },
  environment: { icon: Cloud, label: 'Environment', accent: 'text-slate-600' },
}

export function entityKindMeta(kind: EntityKind) {
  return ENTITY_KIND_META[kind] ?? { icon: Box, label: kind, accent: 'text-muted-foreground' }
}
