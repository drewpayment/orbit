'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { SCOREABLE_FIELDS, fieldByPath, METADATA_PREFIX } from './rule-builder'

/**
 * Autocomplete combobox for a rule's target field path (IDP refocus P2).
 *
 * Unifies known catalog fields and arbitrary custom paths in one control: typing
 * filters the SCOREABLE_FIELDS suggestions (friendly label + the raw dotted path
 * shown muted so users learn the schema), and any value that isn't a known field
 * — e.g. `metadata.costCenter` — is accepted verbatim via the "Use …" row. The
 * assembled `path` is the field's `path` or the typed string unchanged.
 */
export function FieldCombobox({
  id,
  value,
  onChange,
  placeholder = 'Search fields or type a path…',
}: {
  id?: string
  value: string
  onChange: (path: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const known = fieldByPath(value)
  const triggerLabel = known ? known.label : value

  const q = query.trim()
  const lower = q.toLowerCase()
  const matches = q
    ? SCOREABLE_FIELDS.filter(
        (f) => f.label.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower),
      )
    : SCOREABLE_FIELDS
  // Offer free entry whenever the typed value isn't already an exact known path.
  const showFreeEntry = q.length > 0 && !SCOREABLE_FIELDS.some((f) => f.path === q)

  function select(path: string) {
    onChange(path)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      // `modal` is required because this combobox renders inside the Add/Edit
      // rule Dialog: a modal Dialog sets pointer-events:none on the body and
      // locks scroll (react-remove-scroll), so a non-modal Popover portaled to
      // the body shows its list but can't be clicked or scrolled (keyboard still
      // works). Modal mode gives the Popover content its own interactive +
      // scroll-allowed layer.
      modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !triggerLabel && 'text-muted-foreground')}>
            {triggerLabel || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList>
            {matches.length === 0 && !showFreeEntry && <CommandEmpty>No fields found.</CommandEmpty>}
            {matches.length > 0 && (
              <CommandGroup heading="Catalog fields">
                {matches.map((f) => (
                  <CommandItem key={f.path} value={f.path} onSelect={() => select(f.path)}>
                    <Check
                      className={cn('h-4 w-4', value === f.path ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="flex flex-1 items-baseline justify-between gap-2">
                      <span>{f.label}</span>
                      <span className="font-mono text-xs text-muted-foreground">{f.path}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showFreeEntry && (
              <CommandGroup heading="Custom">
                <CommandItem value={`__free__:${q}`} onSelect={() => select(q)}>
                  <Check className={cn('h-4 w-4', value === q ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex flex-col">
                    <span>
                      Use <span className="font-mono">&ldquo;{q}&rdquo;</span>
                    </span>
                    {!q.includes('.') && (
                      <span className="text-xs text-muted-foreground">
                        Custom fields usually live under {METADATA_PREFIX}
                      </span>
                    )}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
