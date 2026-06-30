'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
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
import { ENTITY_KIND_OPTIONS } from './rule-builder'
import { LevelEditor } from './LevelEditor'
import {
  createScorecard,
  updateScorecard,
  type LevelInput,
  type ManageableWorkspace,
} from '@/app/(frontend)/scorecards/actions'

const ALL_KINDS = '__all__'

export interface ScorecardFormInitial {
  name: string
  description?: string | null
  appliesToKind?: string | null
  levels: LevelInput[]
}

type ScorecardFormProps =
  | {
      mode: 'create'
      workspaces: ManageableWorkspace[]
      onDone?: () => void
    }
  | {
      mode: 'edit'
      scorecardId: string
      initial: ScorecardFormInitial
      onDone?: () => void
    }

/**
 * Create/edit form for a scorecard's metadata + maturity ladder (IDP refocus P2).
 * On `create` it renders a workspace picker (the manageable workspaces the page
 * resolved) and redirects to the new detail page; on `edit` it patches in place
 * and refreshes. Authoring is enforced server-side by the actions — this form is
 * only ever rendered for users the page already computed `canManage` for.
 */
export function ScorecardForm(props: ScorecardFormProps) {
  const router = useRouter()
  const isEdit = props.mode === 'edit'
  const initial = isEdit ? props.initial : undefined

  const [workspace, setWorkspace] = useState(
    props.mode === 'create' ? (props.workspaces[0]?.id ?? '') : '',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [kind, setKind] = useState(initial?.appliesToKind || ALL_KINDS)
  const [levels, setLevels] = useState<LevelInput[]>(initial?.levels ?? [])
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('A scorecard name is required.')
      return
    }
    if (props.mode === 'create' && !workspace) {
      toast.error('Select a workspace.')
      return
    }

    setSubmitting(true)
    try {
      const appliesToKind = kind === ALL_KINDS ? null : kind
      if (props.mode === 'create') {
        const { id } = await createScorecard({
          workspace,
          name,
          description,
          appliesToKind,
          levels,
        })
        toast.success('Scorecard created')
        props.onDone?.()
        router.push(`/scorecards/${id}`)
      } else {
        await updateScorecard(props.scorecardId, {
          name,
          description,
          appliesToKind,
          levels,
        })
        toast.success('Scorecard updated')
        props.onDone?.()
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save scorecard')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {props.mode === 'create' && (
        <div className="space-y-1.5">
          <Label htmlFor="sc-workspace">Workspace</Label>
          <Select value={workspace} onValueChange={setWorkspace}>
            <SelectTrigger id="sc-workspace">
              <SelectValue placeholder="Select a workspace" />
            </SelectTrigger>
            <SelectContent>
              {props.workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="sc-name">Name</Label>
        <Input
          id="sc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production readiness"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sc-description">Description</Label>
        <Textarea
          id="sc-description"
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Standards every production service must meet."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sc-kind">Applies to</Label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger id="sc-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_KINDS}>All kinds</SelectItem>
            {ENTITY_KIND_OPTIONS.map((k) => (
              <SelectItem key={k} value={k} className="capitalize">
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <LevelEditor value={levels} onChange={setLevels} />

      <div className="flex justify-end gap-2 pt-2">
        {props.onDone && (
          <Button type="button" variant="outline" onClick={props.onDone} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Create scorecard'}
        </Button>
      </div>
    </form>
  )
}
