import { Building2, Cloud, Github, Sparkles } from 'lucide-react'

interface Chip {
  key: string
  label: string
  suffix?: string
  icon: 'workspace' | 'github' | 'cloud' | 'model'
  accent?: boolean
}

interface Props {
  chips: Chip[]
}

const ICONS = {
  workspace: Building2,
  github: Github,
  cloud: Cloud,
  model: Sparkles,
}

export function ContextStrip({ chips }: Props) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const Icon = ICONS[c.icon]
        return (
          <span
            key={c.key}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-[11.5px] text-foreground/90"
          >
            <Icon
              className={`h-3 w-3 shrink-0 ${c.accent ? 'text-orange-400' : 'text-muted-foreground'}`}
            />
            <span className="text-muted-foreground text-[11px]">{c.key}</span>
            <span>{c.label}</span>
            {c.suffix && (
              <span className="text-muted-foreground text-[11px]">· {c.suffix}</span>
            )}
          </span>
        )
      })}
    </div>
  )
}
