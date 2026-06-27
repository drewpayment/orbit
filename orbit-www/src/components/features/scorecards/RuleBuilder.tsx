'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  buildExpression,
  defaultForm,
  parseExpression,
  validateExpression,
  ENTITY_KIND_OPTIONS,
  RELATION_TYPE_OPTIONS,
  FIELD_PRESENCE_OPS,
  RELATION_DIRECTIONS,
  RULE_TYPES,
  THRESHOLD_OPS,
  type RuleForm,
  type RuleType,
} from './rule-builder'
import { createRule, updateRule } from '@/app/(frontend)/scorecards/actions'
import type { ScorecardRule } from '@/payload-types'

const NO_LEVEL = '__none__'
const NO_TARGET = '__any__'

interface RuleBuilderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scorecardId: string
  levelNames: string[]
  /** Present → edit mode; absent → create mode. */
  rule?: ScorecardRule
}

/**
 * Per-type rule builder (IDP refocus P2) — NO raw JSON. A `type` selector swaps
 * the field set; the fields assemble the exact `expression` shape the evaluator
 * interprets (via buildExpression) and the form validates it (via
 * validateExpression) before calling the RBAC-gated create/update action.
 */
export function RuleBuilder({ open, onOpenChange, scorecardId, levelNames, rule }: RuleBuilderProps) {
  const router = useRouter()
  const isEdit = !!rule

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState<string>(NO_LEVEL)
  const [weight, setWeight] = useState<string>('1')
  const [form, setForm] = useState<RuleForm>(defaultForm('field-presence'))
  const [submitting, setSubmitting] = useState(false)

  // Reset the form to its initial state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setTitle(rule?.title ?? '')
    setDescription(rule?.description ?? '')
    setLevel(rule?.level || NO_LEVEL)
    setWeight(String(rule?.weight ?? 1))
    setForm(rule ? parseExpression(rule.type, rule.expression) : defaultForm('field-presence'))
  }, [open, rule])

  function changeType(type: RuleType) {
    setForm(defaultForm(type))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('A rule title is required.')
      return
    }

    const expression = buildExpression(form)
    const exprError = validateExpression(form.type, expression)
    if (exprError) {
      toast.error(exprError)
      return
    }

    const levelValue = level === NO_LEVEL ? null : level
    const weightNum = Number(weight)

    setSubmitting(true)
    try {
      if (isEdit && rule) {
        await updateRule(rule.id, {
          title,
          description,
          level: levelValue,
          type: form.type,
          expression,
          weight: Number.isFinite(weightNum) ? weightNum : 1,
        })
        toast.success('Rule updated')
      } else {
        await createRule({
          scorecard: scorecardId,
          title,
          description,
          level: levelValue,
          type: form.type,
          expression,
          weight: Number.isFinite(weightNum) ? weightNum : 1,
        })
        toast.success('Rule added')
      }
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save rule')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit rule' : 'Add rule'}</DialogTitle>
          <DialogDescription>
            Rules are checks evaluated against each catalog entity this scorecard applies to.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-title">Title</Label>
            <Input
              id="rule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Has an owner"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-description">Description</Label>
            <Textarea
              id="rule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional explanation shown in the rules list."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rule-level">Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger id="rule-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEVEL}>Base (no level)</SelectItem>
                  {levelNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-weight">Weight</Label>
              <Input
                id="rule-weight"
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-type">Type</Label>
            <Select value={form.type} onValueChange={(v) => changeType(v as RuleType)}>
              <SelectTrigger id="rule-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <RuleTypeFields form={form} onChange={setForm} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Save rule' : 'Add rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The per-type field set — swapped by the rule `type` selector. */
function RuleTypeFields({
  form,
  onChange,
}: {
  form: RuleForm
  onChange: (form: RuleForm) => void
}) {
  if (form.type === 'field-presence') {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="fp-path">Field path</Label>
          <Input
            id="fp-path"
            value={form.path}
            onChange={(e) => onChange({ ...form, path: e.target.value })}
            placeholder="owner, description, metadata.costCenter"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fp-op">Check</Label>
          <Select
            value={form.op}
            onValueChange={(v) => onChange({ ...form, op: v as typeof form.op })}
          >
            <SelectTrigger id="fp-op">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_PRESENCE_OPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  if (form.type === 'relation-check') {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rc-type">Relation type</Label>
            <Select
              value={form.relationType}
              onValueChange={(v) => onChange({ ...form, relationType: v })}
            >
              <SelectTrigger id="rc-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATION_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-direction">Direction</Label>
            <Select
              value={form.direction}
              onValueChange={(v) => onChange({ ...form, direction: v as typeof form.direction })}
            >
              <SelectTrigger id="rc-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATION_DIRECTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rc-target">Target kind</Label>
            <Select
              value={form.targetKind || NO_TARGET}
              onValueChange={(v) => onChange({ ...form, targetKind: v === NO_TARGET ? '' : v })}
            >
              <SelectTrigger id="rc-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TARGET}>Any kind</SelectItem>
                {ENTITY_KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k} className="capitalize">
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-min">Minimum count</Label>
            <Input
              id="rc-min"
              type="number"
              min={0}
              value={form.min}
              onChange={(e) => onChange({ ...form, min: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>
    )
  }

  // threshold
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="th-path">Field path</Label>
        <Input
          id="th-path"
          value={form.path}
          onChange={(e) => onChange({ ...form, path: e.target.value })}
          placeholder="metadata.replicas, lifecycle"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="th-op">Operator</Label>
          <Select
            value={form.op}
            onValueChange={(v) => onChange({ ...form, op: v as typeof form.op })}
          >
            <SelectTrigger id="th-op">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THRESHOLD_OPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="th-value">Value{form.op === 'in' ? ' (comma-separated)' : ''}</Label>
          <Input
            id="th-value"
            value={form.value}
            onChange={(e) => onChange({ ...form, value: e.target.value })}
            placeholder={form.op === 'in' ? 'production, staging' : '3'}
          />
        </div>
      </div>
    </div>
  )
}
