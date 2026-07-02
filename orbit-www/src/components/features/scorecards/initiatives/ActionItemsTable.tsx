'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { updateActionItem } from '@/app/(frontend)/scorecards/initiatives/actions'
import {
  formatDeadline,
  ITEM_STATUS_OPTIONS,
  itemStatusPresentation,
  type ActionItemView,
  type ItemStatus,
} from './initiative-ui'

/**
 * The action-items table for an initiative detail page. Each row links its
 * entity into the catalog, shows the failing rule (+ level), and lets any
 * workspace member update the item's status inline and edit its notes in a
 * popover. Assignee is display-only in v1 (no user-picker convention yet).
 *
 * Mutations call the member-editable updateActionItem action and refresh the
 * route so the server-recomputed progress + updatedAt re-render.
 */
export function ActionItemsTable({ items }: { items: ActionItemView[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function mutate(id: string, patch: Parameters<typeof updateActionItem>[1]) {
    setPendingId(id)
    try {
      await updateActionItem(id, patch)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update item')
    } finally {
      setPendingId(null)
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        No action items yet. Items are generated from the scorecard&rsquo;s failing rules when the
        initiative is created or synced.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Entity</TableHead>
            <TableHead className="min-w-[200px]">Rule</TableHead>
            <TableHead className="min-w-[150px]">Status</TableHead>
            <TableHead className="min-w-[120px]">Assignee</TableHead>
            <TableHead className="min-w-[80px]">Notes</TableHead>
            <TableHead className="min-w-[110px]">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">
                <Link href={`/catalog/${item.entityId}`} className="hover:underline">
                  {item.entityName}
                </Link>
                {item.entityKind && (
                  <span className="ml-1.5 text-xs capitalize text-muted-foreground">
                    {item.entityKind}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span>{item.ruleTitle ?? '—'}</span>
                  {item.ruleLevel && (
                    <Badge variant="outline" className="w-fit font-normal">
                      {item.ruleLevel}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <StatusCell
                  value={item.status}
                  pending={pendingId === item.id}
                  onChange={(status) => mutate(item.id, { status })}
                />
              </TableCell>
              <TableCell className="text-sm">
                {item.assigneeName ? (
                  item.assigneeName
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </TableCell>
              <TableCell>
                <NotesCell
                  notes={item.notes}
                  pending={pendingId === item.id}
                  onSave={(notes) => mutate(item.id, { notes })}
                />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {item.updatedAt ? formatDeadline(item.updatedAt) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function StatusCell({
  value,
  pending,
  onChange,
}: {
  value: string
  pending: boolean
  onChange: (status: ItemStatus) => void
}) {
  const p = itemStatusPresentation(value)
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={(v) => onChange(v as ItemStatus)} disabled={pending}>
        <SelectTrigger className="h-8 w-[140px]">
          <SelectValue>
            <Badge variant={p.variant} className={cn('font-normal', p.className)}>
              {p.label}
            </Badge>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ITEM_STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  )
}

function NotesCell({
  notes,
  pending,
  onSave,
}: {
  notes?: string | null
  pending: boolean
  onSave: (notes: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(notes ?? '')
  const hasNotes = !!notes?.trim()

  function handleOpenChange(next: boolean) {
    if (next) setDraft(notes ?? '')
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 gap-1 px-2', hasNotes ? 'text-foreground' : 'text-muted-foreground')}
          title={hasNotes ? notes ?? undefined : 'Add a note'}
        >
          <StickyNote className="h-4 w-4" />
          {hasNotes ? 'View' : 'Add'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" align="start">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add remediation notes…"
          className="min-h-24"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onSave(draft.trim())
              setOpen(false)
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
