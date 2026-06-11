'use client'

import { CloudOff } from 'lucide-react'

/**
 * Shown when the live SSE connection can't be (re)established — typically
 * because the Temporal workflow's history is gone (retention expired or the
 * workflow was terminated). The persisted transcript stays rendered; this
 * just tells the user the live feed is unavailable so they don't wait on a
 * stream that will never connect.
 */
export function LiveUnavailableBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>Live connection unavailable — showing saved history.</span>
    </div>
  )
}
