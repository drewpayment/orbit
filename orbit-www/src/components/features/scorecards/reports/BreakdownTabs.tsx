'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowDownUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { passRatioTone } from '@/components/features/scorecards/scorecard-ui'
import { ReportEmptyState } from './ReportEmptyState'
import type { GroupBreakdown } from '@/lib/scorecards/reporting'

/**
 * By-team / by-kind breakdown tables (UAC-3): tabs switch the grouping,
 * columns are count / avg score / avg alignment / worst entity (linking to
 * its catalog page). Default order is worst-first (as `computeGroupBreakdown`
 * already returns it); a sort toggle flips to best-first.
 */
export function BreakdownTabs({ byTeam, byKind }: { byTeam: GroupBreakdown[]; byKind: GroupBreakdown[] }) {
  const [ascending, setAscending] = useState(true)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Breakdowns</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="team">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="team">By team</TabsTrigger>
              <TabsTrigger value="kind">By kind</TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setAscending((v) => !v)}
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
              {ascending ? 'Worst first' : 'Best first'}
            </Button>
          </div>
          <TabsContent value="team">
            <BreakdownTable
              rows={byTeam}
              groupLabel="Team"
              ascending={ascending}
              emptyMessage="No teams to report on yet — assign an owning team to catalog entities."
            />
          </TabsContent>
          <TabsContent value="kind">
            <BreakdownTable
              rows={byKind}
              groupLabel="Kind"
              ascending={ascending}
              emptyMessage="No scored entities yet — run an evaluation to populate this breakdown."
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function BreakdownTable({
  rows,
  groupLabel,
  ascending,
  emptyMessage,
}: {
  rows: GroupBreakdown[]
  groupLabel: string
  ascending: boolean
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return <ReportEmptyState>{emptyMessage}</ReportEmptyState>
  }

  // `computeGroupBreakdown` already sorts worst-first (ascending avgScore);
  // the toggle just reverses that order rather than re-sorting.
  const sorted = ascending ? rows : [...rows].reverse()

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{groupLabel}</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Avg score</TableHead>
            <TableHead className="text-right">Avg alignment</TableHead>
            <TableHead>Worst entity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.group}>
              <TableCell className="font-medium capitalize">{row.group}</TableCell>
              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
              <TableCell className={cn('text-right tabular-nums font-medium', passRatioTone(row.avgScore / 100))}>
                {row.avgScore}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.avgAlignment}%</TableCell>
              <TableCell>
                <Link href={`/catalog/${row.worst.id}`} className="hover:underline">
                  {row.worst.name}
                </Link>
                <span className="ml-1.5 text-xs text-muted-foreground">({row.worst.score})</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
