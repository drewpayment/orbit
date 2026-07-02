'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CatalogEntity, CatalogRelation } from '@/payload-types'
import { RELATION_TYPES, type RelationType } from '@/collections/catalog/constants'
import { entityKindMeta } from './entity-kind-meta'
import { toEdges, groupEdgesByType, relationTypeLabel, type RelationEdge } from './entity-relations'
import { EntityPicker } from './entity-form/EntityPicker'
import type { PickerEntity } from './entity-form/entity-form-ui'
import {
  createCatalogRelation,
  deleteCatalogRelation,
  searchEntitiesForPicker,
} from '@/app/(frontend)/catalog/entity-actions'

interface RelationEditorProps {
  focalEntity: Pick<CatalogEntity, 'id' | 'name' | 'kind'>
  relations: CatalogRelation[]
  /** Whether the caller can manage the focal entity (add/remove relations). */
  canManage: boolean
}

type Direction = 'outbound' | 'inbound'

/** Relation ids whose backing source is manual (i.e. user-deletable). */
function manualRelationIds(relations: CatalogRelation[]): Set<string> {
  const ids = new Set<string>()
  for (const rel of relations) {
    if ((rel.source?.type ?? 'manual') === 'manual') ids.add(rel.id)
  }
  return ids
}

/**
 * The Relations tab body: renders the focal entity's typed edges grouped by
 * type/direction (mirroring the read-only EntityRelations look) and, for users
 * with manage rights, adds an "Add relation" dialog and per-edge remove on
 * manual relations. Projected relations are never deletable here (they belong
 * to their projector); the server re-checks RBAC + manual-source on every call.
 */
export function RelationEditor({ focalEntity, relations, canManage }: RelationEditorProps) {
  const router = useRouter()
  const edges = useMemo(() => toEdges(relations, focalEntity.id), [relations, focalEntity.id])
  const groups = useMemo(() => groupEdgesByType(edges), [edges])
  const manualIds = useMemo(() => manualRelationIds(relations), [relations])

  const [removingId, setRemovingId] = useState<string | null>(null)

  async function handleRemove(relationId: string) {
    setRemovingId(relationId)
    try {
      await deleteCatalogRelation(relationId)
      toast.success('Relation removed')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove relation')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <AddRelationDialog focalEntity={focalEntity} onCreated={() => router.refresh()} />
        </div>
      )}

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No relationships yet.{' '}
            {canManage
              ? 'Add a dependency, ownership or lineage edge to connect this entity.'
              : 'Dependencies, ownership and lineage edges appear here as they are added.'}
          </CardContent>
        </Card>
      ) : (
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
                    <NeighborRow
                      key={edge.id}
                      edge={edge}
                      deletable={canManage && manualIds.has(edge.id)}
                      pending={removingId === edge.id}
                      onRemove={() => handleRemove(edge.id)}
                    />
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NeighborRow({
  edge,
  deletable,
  pending,
  onRemove,
}: {
  edge: RelationEdge
  deletable: boolean
  pending: boolean
  onRemove: () => void
}) {
  const meta = entityKindMeta(edge.neighbor.kind)
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${meta.accent}`} />
      <Link
        href={`/catalog/${edge.neighbor.id}`}
        className="flex-1 truncate text-sm font-medium hover:underline"
      >
        {edge.neighbor.name}
      </Link>
      <Badge variant="outline" className="shrink-0 text-xs">
        {meta.label}
      </Badge>
      {deletable && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove relation"
              disabled={pending}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this relation?</AlertDialogTitle>
              <AlertDialogDescription>
                The edge to &ldquo;{edge.neighbor.name}&rdquo; will be removed. The entities
                themselves are unaffected. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  onRemove()
                }}
                disabled={pending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

function AddRelationDialog({
  focalEntity,
  onCreated,
}: {
  focalEntity: Pick<CatalogEntity, 'id' | 'name' | 'kind'>
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<Direction>('outbound')
  const [type, setType] = useState<RelationType>('depends-on')
  const [target, setTarget] = useState<PickerEntity | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setDirection('outbound')
    setType('depends-on')
    setTarget(null)
  }

  const search = useMemo(
    () => (query: string) => searchEntitiesForPicker(query, { excludeId: focalEntity.id }),
    [focalEntity.id],
  )

  async function handleSubmit() {
    if (!target) {
      toast.error('Select an entity to relate to.')
      return
    }
    // Direction decides which side the focal entity sits on. RBAC is enforced
    // on the `from` entity server-side, so an inbound edge from an entity the
    // caller can't manage is rejected there (surfaced as a toast).
    const fromId = direction === 'outbound' ? focalEntity.id : target.id
    const toId = direction === 'outbound' ? target.id : focalEntity.id

    setSubmitting(true)
    try {
      await createCatalogRelation({ fromId, toId, type })
      toast.success('Relation added')
      setOpen(false)
      reset()
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add relation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="h-4 w-4" />
          Add relation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a relation</DialogTitle>
          <DialogDescription>
            Connect &ldquo;{focalEntity.name}&rdquo; to another entity with a typed edge.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="relation-direction">Direction</Label>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as Direction)}
              disabled={submitting}
            >
              <SelectTrigger id="relation-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outbound">This entity → other</SelectItem>
                <SelectItem value="inbound">Other → this entity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as RelationType)}
              disabled={submitting}
            >
              <SelectTrigger id="relation-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {relationTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-target">Entity</Label>
            <EntityPicker
              id="relation-target"
              value={target}
              onSelect={setTarget}
              search={search}
              placeholder="Search the catalog…"
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || !target}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add relation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
