'use client'

import { useMemo, useState } from 'react'
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
import { createInitiative } from '@/app/(frontend)/scorecards/initiatives/actions'
import type { ScorecardOption } from './initiative-ui'

/**
 * Create form for an initiative (IDP refocus P2). Picks a scorecard, then a
 * target level populated from that scorecard's ladder, plus an optional
 * deadline. On success redirects to the new initiative's detail page.
 *
 * Authoring is RBAC-enforced server-side in createInitiative; the page only
 * renders this form for owners/admins.
 */
export function InitiativeForm({ scorecards }: { scorecards: ScorecardOption[] }) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scorecardId, setScorecardId] = useState(scorecards[0]?.id ?? '')
  const [deadline, setDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Ladder for the currently-selected scorecard, lowest rung first.
  const levels = useMemo(() => {
    const sc = scorecards.find((s) => s.id === scorecardId)
    return [...(sc?.levels ?? [])].sort((a, b) => a.rank - b.rank)
  }, [scorecards, scorecardId])

  const [targetLevel, setTargetLevel] = useState(scorecards[0]?.levels?.[0]?.name ?? '')

  function handleScorecardChange(id: string) {
    setScorecardId(id)
    const sc = scorecards.find((s) => s.id === id)
    const ladder = [...(sc?.levels ?? [])].sort((a, b) => a.rank - b.rank)
    setTargetLevel(ladder[0]?.name ?? '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('An initiative name is required.')
      return
    }
    if (!scorecardId) {
      toast.error('Select a scorecard.')
      return
    }
    if (!targetLevel) {
      toast.error('Select a target level.')
      return
    }

    setSubmitting(true)
    try {
      const { id } = await createInitiative({
        name: name.trim(),
        description: description.trim() || undefined,
        scorecardId,
        targetLevel,
        deadline: deadline || undefined,
      })
      toast.success('Initiative created')
      router.push(`/scorecards/initiatives/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create initiative')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="init-name">Name</Label>
        <Input
          id="init-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Reach Silver on Production readiness"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="init-description">Description</Label>
        <Textarea
          id="init-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Why this campaign matters and what &ldquo;done&rdquo; looks like."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="init-scorecard">Scorecard</Label>
        <Select value={scorecardId} onValueChange={handleScorecardChange}>
          <SelectTrigger id="init-scorecard">
            <SelectValue placeholder="Select a scorecard" />
          </SelectTrigger>
          <SelectContent>
            {scorecards.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="init-target">Target level</Label>
        <Select value={targetLevel} onValueChange={setTargetLevel} disabled={levels.length === 0}>
          <SelectTrigger id="init-target">
            <SelectValue placeholder="Select a target level" />
          </SelectTrigger>
          <SelectContent>
            {levels.map((l) => (
              <SelectItem key={l.name} value={l.name}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Action items are generated for every failing rule at or below this level.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="init-deadline">Deadline</Label>
        <Input
          id="init-deadline"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-fit"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create initiative
        </Button>
      </div>
    </form>
  )
}
