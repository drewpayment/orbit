/**
 * Shared expression-capable input — Template Authoring Phase 2, Task 11
 * (also used by `OutputBuilder`, Task 12). A plain `Input`/`Textarea` with a
 * small `${{ }}` insert menu (Popover + Command, built on the existing
 * `command.tsx`/`popover.tsx` — no new editor dependency), offering
 * `candidates` (from `expression-autocomplete.ts`).
 *
 * Inserting a candidate wraps it as `${{ <path> }}` and inserts it at the
 * caret position (falling back to the end of the value when the caret
 * position isn't available, e.g. in tests using `fireEvent`), so it always
 * produces a syntactically valid expression rather than string-concatenating
 * a bare path.
 */
'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Braces } from 'lucide-react'
import type { ExpressionCandidate } from './expression-autocomplete'

export interface ExpressionInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  candidates: ExpressionCandidate[]
  placeholder?: string
  disabled?: boolean
  multiline?: boolean
  'aria-invalid'?: boolean
}

export function ExpressionInput({
  id,
  value,
  onChange,
  candidates,
  placeholder,
  disabled,
  multiline,
  ...rest
}: ExpressionInputProps) {
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  function insert(path: string) {
    const token = `\${{ ${path} }}`
    const el = inputRef.current
    const caret = el && document.activeElement === el ? (el.selectionStart ?? value.length) : value.length
    const caretEnd = el && document.activeElement === el ? (el.selectionEnd ?? caret) : caret
    const next = value.slice(0, caret) + token + value.slice(caretEnd)
    onChange(next)
    setOpen(false)
  }

  const Field = multiline ? Textarea : Input

  return (
    <div className="flex items-start gap-1.5">
      <Field
        id={id}
        ref={inputRef as never}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={rest['aria-invalid']}
        className="flex-1"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            aria-label="Insert expression"
          >
            <Braces className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="end">
          <Command>
            <CommandInput placeholder="Search parameters and step outputs…" />
            <CommandList>
              <CommandEmpty>No candidates available.</CommandEmpty>
              <CommandGroup>
                {candidates.map((c) => (
                  <CommandItem key={c.path} value={c.path} onSelect={() => insert(c.path)}>
                    <span className="font-mono text-xs">{c.path}</span>
                    {c.description && (
                      <span className="ml-auto text-xs text-muted-foreground">{c.description}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
