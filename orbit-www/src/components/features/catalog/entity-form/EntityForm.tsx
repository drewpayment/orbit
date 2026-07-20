'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CatalogEntity } from '@/payload-types'
import { ENTITY_KINDS, type EntityKind } from '@/collections/catalog/constants'
import { KIND_LABELS_SINGULAR } from '../catalog-query'
import {
  createCatalogEntity,
  updateCatalogEntity,
  searchEntitiesForPicker,
} from '@/app/(frontend)/catalog/entity-actions'
import { EntityPicker } from './EntityPicker'
import { EntityLinksEditor } from './EntityLinksEditor'
import {
  LIFECYCLE_OPTIONS,
  TIER_OPTIONS,
  RUNTIME_PLATFORM_OPTIONS,
  buildWorkspaceOptions,
  collectLinkErrors,
  idToWorkspaceSelection,
  isSourceLocked,
  linksToRows,
  newLinkRow,
  rowsToLinks,
  sourceProvenanceLabel,
  subtypePlaceholder,
  workspaceSelectionToId,
  type EntityFormOptions,
  type LinkRow,
  type Lifecycle,
  type PickerEntity,
  type Tier,
} from './entity-form-ui'
import type { RuntimePlatform } from '@/collections/catalog/constants'
import { SUBTYPE_MAX_LENGTH } from '@/lib/catalog/entity-crud'

/** Sentinel `<Select>` value for an unset optional field (lifecycle/tier). */
const NONE = '__none__'

export interface EntityFormProps {
  mode: 'create' | 'edit'
  /** Workspaces the caller can create in + platform-admin global flag. */
  options: EntityFormOptions
  /** Edit mode: the entity being edited (prefill + projection source-lock). */
  entity?: CatalogEntity
  /**
   * Preselect AND lock the workspace (WP3 workspace landpage "New entity" /
   * "Create team"). Ignored in edit mode (workspace is not reassignable here).
   */
  fixedWorkspaceId?: string
  /** Preselect the kind (e.g. WP3 "Create team" → 'team'). Create mode only. */
  defaultKind?: EntityKind
  /** Lock the kind selector (e.g. WP3 "Create team"). */
  lockKind?: boolean
  /** Redirect target after success. Defaults to the entity detail page. */
  onSuccessRedirect?: string
}

function workspaceIdOf(entity: CatalogEntity | undefined): string | null {
  const ws = entity?.workspace
  if (ws == null) return null
  return typeof ws === 'string' ? ws : ws.id
}

function workspaceNameOf(entity: CatalogEntity | undefined): string | null {
  const ws = entity?.workspace
  if (ws == null || typeof ws === 'string') return null
  return ws.name ?? null
}

function ownerOf(entity: CatalogEntity | undefined): PickerEntity | null {
  const owner = entity?.owner
  if (!owner || typeof owner === 'string') return null
  return { id: owner.id, name: owner.name, kind: 'team' }
}

/**
 * Create/edit form for a catalog entity (WP2). Reused by the catalog `new`/
 * `edit` pages and the WP3 workspace landpage.
 *
 * Field ownership: for a projected entity (`source.type` !== 'manual') the
 * identity fields (name, kind, workspace) render read-only with a provenance
 * note; curation fields stay editable. The server re-checks both RBAC and the
 * field-ownership policy, so this is a UX affordance, not the security gate.
 */
export function EntityForm({
  mode,
  options,
  entity,
  fixedWorkspaceId,
  defaultKind,
  lockKind,
  onSuccessRedirect,
}: EntityFormProps) {
  const router = useRouter()
  const isEdit = mode === 'edit'
  const sourceType = entity?.source?.type ?? 'manual'
  const locked = isEdit && isSourceLocked(sourceType)
  const provenance = sourceProvenanceLabel(sourceType)

  const workspaceOptions = buildWorkspaceOptions(options.workspaces, options.canCreateGlobal)

  const [name, setName] = useState(entity?.name ?? '')
  const [kind, setKind] = useState<EntityKind>((entity?.kind as EntityKind) ?? defaultKind ?? 'service')
  const [workspaceSelection, setWorkspaceSelection] = useState<string>(() => {
    if (isEdit) return idToWorkspaceSelection(workspaceIdOf(entity))
    if (fixedWorkspaceId) return fixedWorkspaceId
    return workspaceOptions[0]?.value ?? ''
  })
  const [description, setDescription] = useState(entity?.description ?? '')
  const [subtype, setSubtype] = useState(entity?.subtype ?? '')
  const [runtimeUrl, setRuntimeUrl] = useState(entity?.runtime?.url ?? '')
  const [runtimePlatform, setRuntimePlatform] = useState<RuntimePlatform | typeof NONE>(
    entity?.runtime?.platform ?? NONE,
  )
  const [runtimeNotes, setRuntimeNotes] = useState(entity?.runtime?.notes ?? '')
  const [lifecycle, setLifecycle] = useState<Lifecycle | typeof NONE>(entity?.lifecycle ?? NONE)
  const [tier, setTier] = useState<Tier | typeof NONE>(entity?.tier ?? NONE)
  const [owner, setOwner] = useState<PickerEntity | null>(ownerOf(entity))
  const [linkRows, setLinkRows] = useState<LinkRow[]>(
    entity?.links ? linksToRows(entity.links) : [newLinkRow()],
  )
  const [submitting, setSubmitting] = useState(false)

  const workspaceLabel =
    workspaceNameOf(entity) ??
    (workspaceIdOf(entity) === null ? 'Global (no workspace)' : 'Workspace')

  const searchTeams = useCallback(
    (query: string) => searchEntitiesForPicker(query, { kind: 'team', excludeId: entity?.id }),
    [entity?.id],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('A name is required.')
      return
    }
    if (mode === 'create' && !workspaceSelection) {
      toast.error('Select a workspace.')
      return
    }
    const linkError = collectLinkErrors(linkRows)
    if (linkError) {
      toast.error(linkError)
      return
    }

    const links = rowsToLinks(linkRows)
    const lifecycleValue = lifecycle === NONE ? null : lifecycle
    const tierValue = tier === NONE ? null : tier
    const subtypeValue = subtype.trim()
    const runtime = {
      url: runtimeUrl.trim() || null,
      platform: runtimePlatform === NONE ? null : runtimePlatform,
      notes: runtimeNotes.trim() || null,
    }
    const hasRuntime = !!(runtime.url || runtime.platform || runtime.notes)

    setSubmitting(true)
    try {
      if (mode === 'create') {
        const { id } = await createCatalogEntity({
          kind,
          name: trimmedName,
          workspaceId: workspaceSelectionToId(workspaceSelection),
          description: description.trim() || undefined,
          subtype: subtypeValue || undefined,
          runtime: hasRuntime ? runtime : undefined,
          lifecycle: lifecycleValue ?? undefined,
          tier: tierValue ?? undefined,
          ownerId: owner?.id ?? undefined,
          links,
        })
        toast.success('Entity created')
        router.push(onSuccessRedirect ?? `/catalog/${id}`)
      } else if (entity) {
        await updateCatalogEntity(entity.id, {
          // Identity fields are only sent for manual entities; the server
          // rejects them on projected entities regardless.
          ...(locked ? {} : { name: trimmedName, kind }),
          description: description.trim() || null,
          // subtype + runtime are curation fields — editable even when locked.
          subtype: subtypeValue || null,
          runtime,
          lifecycle: lifecycleValue,
          tier: tierValue,
          ownerId: owner?.id ?? null,
          links,
        })
        toast.success('Entity updated')
        router.push(onSuccessRedirect ?? `/catalog/${entity.id}`)
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save entity')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {locked && provenance && (
        <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {provenance}. Identity fields are managed by the source; edit description, lifecycle,
            tier, owner and links here.
          </span>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entity-kind">Kind</Label>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as EntityKind)}
            disabled={locked || lockKind || submitting}
          >
            <SelectTrigger id="entity-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS_SINGULAR[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="entity-workspace">Workspace</Label>
          {isEdit ? (
            <Input id="entity-workspace" value={workspaceLabel} disabled readOnly />
          ) : (
            <Select
              value={workspaceSelection}
              onValueChange={setWorkspaceSelection}
              disabled={!!fixedWorkspaceId || submitting || workspaceOptions.length === 0}
            >
              <SelectTrigger id="entity-workspace">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaceOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="entity-name">Name</Label>
        <Input
          id="entity-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Payments API"
          disabled={locked || submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="entity-description">Description</Label>
        <Textarea
          id="entity-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this entity is and who relies on it."
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="entity-subtype">Subtype</Label>
        <Input
          id="entity-subtype"
          value={subtype}
          onChange={(e) => setSubtype(e.target.value)}
          placeholder={subtypePlaceholder(kind)}
          maxLength={SUBTYPE_MAX_LENGTH}
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          A free-form refinement of the kind — no new entity type needed.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entity-lifecycle">Lifecycle</Label>
          <Select
            value={lifecycle}
            onValueChange={(v) => setLifecycle(v as Lifecycle | typeof NONE)}
            disabled={submitting}
          >
            <SelectTrigger id="entity-lifecycle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {LIFECYCLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="entity-tier">Tier</Label>
          <Select
            value={tier}
            onValueChange={(v) => setTier(v as Tier | typeof NONE)}
            disabled={submitting}
          >
            <SelectTrigger id="entity-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {TIER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="entity-owner">Owner team</Label>
        <EntityPicker
          id="entity-owner"
          value={owner}
          onSelect={setOwner}
          search={searchTeams}
          placeholder="Search for a team…"
          emptyText="No teams found."
          allowClear
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          The team entity that owns this. Create team entities from a workspace to populate this.
        </p>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-medium">Runtime</h3>
          <p className="text-xs text-muted-foreground">
            Where this entity runs and how to reach it. Topology lives in relations; this is the
            human-facing pointer.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="entity-runtime-url">URL</Label>
            <Input
              id="entity-runtime-url"
              type="url"
              value={runtimeUrl}
              onChange={(e) => setRuntimeUrl(e.target.value)}
              placeholder="https://app.example.com"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-runtime-platform">Platform</Label>
            <Select
              value={runtimePlatform}
              onValueChange={(v) => setRuntimePlatform(v as RuntimePlatform | typeof NONE)}
              disabled={submitting}
            >
              <SelectTrigger id="entity-runtime-platform">
                <SelectValue placeholder="Select a platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {RUNTIME_PLATFORM_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entity-runtime-notes">Notes</Label>
          <Textarea
            id="entity-runtime-notes"
            value={runtimeNotes}
            onChange={(e) => setRuntimeNotes(e.target.value)}
            placeholder="Access details, quirks, how to reach it."
            disabled={submitting}
          />
        </div>
      </div>

      <EntityLinksEditor rows={linkRows} onChange={setLinkRows} disabled={submitting} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'create' ? 'Create entity' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
