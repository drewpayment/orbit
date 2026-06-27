'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RunActionDialog } from './RunActionDialog'
import { backendTypeIcon, backendTypeLabel, approvalPolicyLabel } from './action-ui'
import type { ActionSummary } from '@/app/(frontend)/self-service/actions'

/**
 * A self-service Action rendered as a clickable catalog card: name, description,
 * a backend-type badge and (when gated) an approval badge. Clicking opens the
 * {@link RunActionDialog} to collect inputs and start a run.
 */
export function ActionCard({ action }: { action: ActionSummary }) {
  const [open, setOpen] = useState(false)
  const Icon = backendTypeIcon(action.backendType)
  const approval = approvalPolicyLabel(action.approvalPolicy)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-left">
        <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="truncate text-base" title={action.name}>
                {action.name}
              </CardTitle>
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal">
                {backendTypeLabel(action.backendType)}
              </Badge>
              {approval && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <ShieldCheck className="h-3 w-3" />
                  {approval}
                </Badge>
              )}
            </div>
          </CardHeader>
          {action.description && (
            <CardContent>
              <p className="line-clamp-2 text-sm text-muted-foreground">{action.description}</p>
            </CardContent>
          )}
        </Card>
      </button>

      <RunActionDialog action={action} open={open} onOpenChange={setOpen} />
    </>
  )
}
