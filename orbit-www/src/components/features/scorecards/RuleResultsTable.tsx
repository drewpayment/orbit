import Link from 'next/link'
import { Check, Minus, X } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ScoreChip } from './ScoreChip'
import { ruleTypeLabel, type LevelDef } from './scorecard-ui'
import type { EntityRow } from '@/app/(frontend)/scorecards/actions'
import type { ScorecardRule } from '@/payload-types'

/**
 * The entities × rules pass/fail matrix for a scorecard detail page. Each row is
 * an entity (linking to its catalog page) with its computed level chip and a
 * pass/fail/—cell per rule. Column headers carry the rule title, type and level.
 */
export function RuleResultsTable({
  rules,
  rows,
}: {
  rules: ScorecardRule[]
  rows: EntityRow[]
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        No entities have been evaluated yet. Run an evaluation to populate this matrix.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-[200px] bg-background">Entity</TableHead>
            <TableHead className="min-w-[120px]">Level</TableHead>
            {rules.map((rule) => (
              <TableHead key={rule.id} className="min-w-[120px] align-bottom">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground" title={rule.description ?? undefined}>
                    {rule.title}
                  </span>
                  <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                    {ruleTypeLabel(rule.type)}
                    {rule.level ? ` · ${rule.level}` : ''}
                  </span>
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.entityId}>
              <TableCell className="sticky left-0 z-10 bg-background font-medium">
                <Link href={`/catalog/${row.entityId}`} className="hover:underline">
                  {row.entityName}
                </Link>
              </TableCell>
              <TableCell>
                <ScoreChip
                  level={row.level as LevelDef | null}
                  passed={row.passed}
                  total={row.total}
                />
              </TableCell>
              {rules.map((rule) => {
                const result = row.results[rule.id]
                return (
                  <TableCell key={rule.id} className="text-center">
                    <ResultMark result={result} />
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ResultMark({ result }: { result?: { passed: boolean; detail?: string | null } }) {
  if (!result) {
    return <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="Not evaluated" />
  }
  const Icon = result.passed ? Check : X
  return (
    <Icon
      className={cn('mx-auto h-4 w-4', result.passed ? 'text-emerald-600' : 'text-red-600')}
      aria-label={result.passed ? 'Pass' : 'Fail'}
    />
  )
}
