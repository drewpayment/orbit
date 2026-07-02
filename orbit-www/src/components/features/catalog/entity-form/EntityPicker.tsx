'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { entityKindMeta } from '../entity-kind-meta'
import type { PickerEntity } from './entity-form-ui'

interface EntityPickerProps {
  /** Currently-selected entity (for the trigger label + tick), or null. */
  value: PickerEntity | null
  onSelect: (entity: PickerEntity | null) => void
  /** Org-wide async search — supplied by the caller so this stays decoupled. */
  search: (query: string) => Promise<PickerEntity[]>
  placeholder?: string
  /** Empty-state copy when a non-empty query returns nothing. */
  emptyText?: string
  /** When true the selection can be cleared back to null (owner is optional). */
  allowClear?: boolean
  disabled?: boolean
  id?: string
}

/**
 * Search-as-you-type entity combobox used by the owner picker and the relation
 * editor. Presentational + self-contained: it owns query/debounce/loading state
 * but delegates the actual lookup to the `search` prop, so it never imports a
 * server action directly (the form/detail wires `searchEntitiesForPicker`).
 */
export function EntityPicker({
  value,
  onSelect,
  search,
  placeholder = 'Search entities…',
  emptyText = 'No entities found.',
  allowClear = false,
  disabled,
  id,
}: EntityPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickerEntity[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(
    (q: string) => {
      setQuery(q)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const trimmed = q.trim()
      if (trimmed.length < 2) {
        setResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      debounceRef.current = setTimeout(async () => {
        try {
          const found = await search(trimmed)
          setResults(found)
        } catch {
          setResults([])
        } finally {
          setLoading(false)
        }
      }, 250)
    },
    [search],
  )

  // Reset the transient search state whenever the popover closes.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setLoading(false)
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="truncate">{value.name}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <span className="ml-2 flex items-center gap-1">
            {allowClear && value && (
              <X
                className="h-3.5 w-3.5 shrink-0 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onSelect(null)
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={query} onValueChange={runSearch} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {query.trim().length < 2 ? 'Type at least 2 characters…' : emptyText}
                </CommandEmpty>
                <CommandGroup>
                  {results.map((entity) => {
                    const meta = entityKindMeta(entity.kind)
                    const Icon = meta.icon
                    return (
                      <CommandItem
                        key={entity.id}
                        value={entity.id}
                        onSelect={() => {
                          onSelect(entity)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            value?.id === entity.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <Icon className={cn('mr-2 h-4 w-4 shrink-0', meta.accent)} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{entity.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {meta.label}
                            {entity.workspaceName ? ` · ${entity.workspaceName}` : ''}
                          </span>
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
