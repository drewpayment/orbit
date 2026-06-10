'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LayoutTemplate, Plus, Sparkles } from 'lucide-react'

interface DashboardHeroProps {
  userName: string
  attentionCount?: number
  workspaceCount?: number
  newWorkspaceHref?: string
  browseTemplatesHref?: string
  askAgentHref?: string
}

function pickGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardHero({
  userName,
  attentionCount = 0,
  workspaceCount = 0,
  newWorkspaceHref = '/admin/workspaces',
  browseTemplatesHref = '/templates',
  askAgentHref = '/agent',
}: DashboardHeroProps) {
  const [greeting, setGreeting] = useState('Welcome')

  useEffect(() => {
    setGreeting(pickGreeting())
  }, [])

  const headline = userName ? (
    <>
      {greeting}, <span className="text-primary">{userName}</span>
    </>
  ) : (
    greeting
  )

  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {headline}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
          {attentionCount > 0 ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11.5px] font-medium text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                {attentionCount} agent run{attentionCount === 1 ? '' : 's'} need attention
              </span>
              <span className="h-[3px] w-[3px] rounded-full bg-border" />
              <span>
                Across <strong className="font-medium text-foreground/80">{workspaceCount} workspace{workspaceCount === 1 ? '' : 's'}</strong>
              </span>
            </>
          ) : (
            <span>All clear — nothing waiting on you.</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link href={browseTemplatesHref}>
            <LayoutTemplate className="mr-1.5 h-4 w-4" />
            Browse templates
          </Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={askAgentHref}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Ask the agent
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link href={newWorkspaceHref}>
            <Plus className="mr-1.5 h-4 w-4" />
            New workspace
          </Link>
        </Button>
      </div>
    </div>
  )
}
