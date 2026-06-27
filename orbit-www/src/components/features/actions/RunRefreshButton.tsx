'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Manual refresh for an Action Run page. Runs advance asynchronously (the runner
 * / Temporal worker writes status + logs back out-of-band), so a click re-fetches
 * the server component rather than relying on polling.
 */
export function RunRefreshButton() {
  const router = useRouter()
  const [spinning, setSpinning] = useState(false)

  function handleClick() {
    setSpinning(true)
    router.refresh()
    // The refresh pending flag does not reliably clear; reset the spin shortly after.
    setTimeout(() => setSpinning(false), 600)
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick}>
      <RefreshCw className={cn('h-4 w-4', spinning && 'animate-spin')} />
      Refresh
    </Button>
  )
}
