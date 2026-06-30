import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RunStatusBadge } from './RunStatusBadge'
import { formatRelativeTime, triggerLabel } from './action-ui'
import type { ActionRun } from '@/payload-types'

/**
 * Tabular history of Action Runs: action name, status, trigger, when and who.
 * Each row links to the run detail. Relationship fields may arrive populated
 * (depth) or as bare ids — both are handled defensively.
 */
export function RunsTable({ runs }: { runs: ActionRun[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <Link href={`/self-service/runs/${run.id}`} className="font-medium hover:underline">
                  {actionName(run.action)}
                </Link>
              </TableCell>
              <TableCell>
                <RunStatusBadge status={run.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{triggerLabel(run.trigger)}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatRelativeTime(run.createdAt)}
              </TableCell>
              <TableCell className="text-muted-foreground">{userName(run.triggeredBy)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function actionName(action: ActionRun['action']): string {
  if (!action) return 'Action'
  if (typeof action === 'string') return action
  return action.name ?? action.id
}

function userName(user: ActionRun['triggeredBy']): string {
  if (!user) return '—'
  if (typeof user === 'string') return user
  return user.name || user.email || user.id
}
