'use client'

import { useRef } from 'react'
import { Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface SlashChip {
  key: string
  label: string
}

const SLASH_CHIPS: SlashChip[] = [
  { key: '/approve', label: 'approve current plan' },
  { key: '/modify', label: 'change a field' },
  { key: '/reject', label: 'rewrite the plan' },
  { key: '/abort', label: 'stop the run' },
]

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  awaiting: boolean
  disabled: boolean
  sending: boolean
}

export function Composer({ value, onChange, onSend, awaiting, disabled, sending }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const placeholder = disabled
    ? 'Run finished. Start a new one to continue.'
    : awaiting
      ? 'Reply, or add notes for the agent (e.g. "use ohio region instead")…'
      : 'Ask the agent a follow-up, or kick off a new step…'

  const insertChip = (key: string) => {
    const prefix = value.trim() ? value.trim() + ' ' : ''
    onChange(`${prefix}${key} `)
    requestAnimationFrame(() => ref.current?.focus())
  }

  return (
    <div className="rounded-xl border bg-background/70 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {SLASH_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => insertChip(chip.key)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
          >
            <span className="font-mono text-[11px] text-orange-400">{chip.key}</span>
            <span>{chip.label}</span>
          </button>
        ))}
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSend()
          }
        }}
        className="resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center justify-between border-t border-dashed pt-2">
        <span className="text-[11.5px] text-muted-foreground/70">
          ⌘/Ctrl+Enter to send · / for actions
        </span>
        <Button
          size="sm"
          onClick={onSend}
          disabled={disabled || sending || !value.trim()}
          className="h-7 px-2.5 text-xs"
        >
          <Send className="mr-1 h-3 w-3" /> Send
        </Button>
      </div>
    </div>
  )
}
