import Link from 'next/link'
import { CalendarClock, ShieldCheck, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { InitiativeProgressBar } from './InitiativeProgress'
import {
  formatDeadline,
  initiativeStatusPresentation,
  isOverdue,
  targetLevelLabel,
  type InitiativeSummaryView,
} from './initiative-ui'

/**
 * An initiative rendered as a clickable list card: name, scorecard, target-level
 * chip, status badge, deadline (overdue flagged), progress bar + counts, owner.
 * Links to `/scorecards/initiatives/{id}`.
 */
export function InitiativeCard({ initiative }: { initiative: InitiativeSummaryView }) {
  const status = initiativeStatusPresentation(initiative.status)
  const overdue = initiative.status === 'active' && isOverdue(initiative.deadline, new Date())

  return (
    <Link
      href={`/scorecards/initiatives/${initiative.id}`}
      className="block focus:outline-none"
    >
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate text-base" title={initiative.name}>
              {initiative.name}
            </CardTitle>
            <Badge variant={status.variant} className={cn('shrink-0 font-normal', status.className)}>
              {status.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="gap-1 font-normal">
              <ShieldCheck className="h-3 w-3" />
              {initiative.scorecardName}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {targetLevelLabel(initiative.targetLevel)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <InitiativeProgressBar progress={initiative.progress} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span
              className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-red-600')}
            >
              <CalendarClock className="h-3 w-3" />
              {formatDeadline(initiative.deadline)}
              {overdue && ' · overdue'}
            </span>
            {initiative.ownerName && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" />
                {initiative.ownerName}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
