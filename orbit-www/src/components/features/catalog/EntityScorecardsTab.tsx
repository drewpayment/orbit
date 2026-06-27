'use client'

import { ClipboardCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

/**
 * P2 placeholder. Scorecard rules evaluate against entity metadata/tier and are
 * out of scope for P1 — this tab just signals what's coming so the IA is stable.
 */
export function EntityScorecardsTab() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Scorecards arrive in P2</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Quality, security and production-readiness scorecards will grade this entity against
          its tier here.
        </p>
      </CardContent>
    </Card>
  )
}
