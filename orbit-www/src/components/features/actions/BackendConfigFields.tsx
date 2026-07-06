'use client'

import { Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Action } from '@/payload-types'
import { BACKEND_TYPE_OPTIONS, BACKEND_TYPE_META } from './action-backends'

type BackendType = Action['backend']['type']

export interface BackendConfig {
  type: BackendType
  ref: string
}

interface BackendConfigFieldsProps {
  value: BackendConfig
  onChange: (next: BackendConfig) => void
}

/**
 * Backend executor editor for the Action form (IDP refocus P3). A type picker
 * over the allowed `backend.type` values plus a single `ref` input whose label,
 * helper text, and placeholder adapt to the selected type (handler id / POST URL
 * / workflow id / prompt ref …). Deferred backends (temporal-*, kafka, agent)
 * surface a note that they are authored now but not yet executed by the runner.
 */
export function BackendConfigFields({ value, onChange }: BackendConfigFieldsProps) {
  const meta = BACKEND_TYPE_META[value.type]

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="action-backend-type">Backend</Label>
        <Select
          value={value.type}
          onValueChange={(type) => onChange({ ...value, type: type as BackendType })}
        >
          <SelectTrigger id="action-backend-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKEND_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-backend-ref">{meta.refLabel}</Label>
        <Input
          id="action-backend-ref"
          value={value.ref}
          onChange={(e) => onChange({ ...value, ref: e.target.value })}
          placeholder={meta.refPlaceholder}
        />
        <p className="text-xs text-muted-foreground">{meta.refHelp}</p>
      </div>

      {meta.deferred && (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This backend type can be authored now but is <strong>not yet executed</strong> — its
            runs are dispatched by the Temporal ActionDispatch workflow, which is still deferred.
          </span>
        </div>
      )}
    </div>
  )
}
