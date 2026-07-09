import Link from 'next/link'
import { Building2, Globe, MoreHorizontal, ScanSearch, ArrowUpRight } from 'lucide-react'
import type { DiscoveryAttention, DiscoveryAttentionGroup } from '@/lib/discovery/attention-core'

/**
 * Dashboard Attention Hub discovery card (WP7, Phase 1.5,
 * docs/plans/2026-07-06-catalog-discovery.md).
 *
 * A bounded, server-rendered card that sits beside `DashboardAttention` and
 * surfaces `status: 'proposed'` discovery proposals grouped by workspace (member
 * workspaces only; platform admins also see the global queue). Each row links to
 * that workspace's review queue. Renders NOTHING when there is nothing to review
 * — the hub is bounded and shows no empty chrome (matches DashboardAttention's
 * "return null when empty" contract).
 */
export function DiscoveryAttentionCard({ data }: { data: DiscoveryAttention }) {
  if (data.total === 0) return null

  const reviewLabel = `${data.total} proposal${data.total === 1 ? '' : 's'} to review`

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex h-11 items-center gap-3 px-4">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <ScanSearch className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-foreground">
          Discovery proposals
        </span>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">
          <span className="text-muted-foreground/60">·</span> {reviewLabel}
        </span>
      </header>

      <div className="flex flex-col gap-1.5 border-t border-border p-3">
        {data.groups.map((group) => (
          <GroupRow key={group.workspaceId ?? 'global'} group={group} />
        ))}
      </div>
    </section>
  )
}

function hrefFor(group: DiscoveryAttentionGroup): string | null {
  if (group.workspaceId === 'overflow') return null
  if (group.workspaceId === null) return '/discovery'
  if (!group.workspaceSlug) return null
  return `/workspaces/${group.workspaceSlug}/discovery`
}

function GroupRow({ group }: { group: DiscoveryAttentionGroup }) {
  const isGlobal = group.workspaceId === null
  const isOverflow = group.workspaceId === 'overflow'
  const Icon = isGlobal ? Globe : isOverflow ? MoreHorizontal : Building2
  const href = hrefFor(group)

  const inner = (
    <>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.005em] text-foreground">
        {group.workspaceName}
      </span>
      <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
        {group.proposed}
      </span>
      {href && (
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
    </>
  )

  // The overflow remainder (and any group missing a link target) is a static
  // summary row — everything else is a full-width link into that review queue.
  if (!href) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
        {inner}
      </div>
    )
  }

  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 transition-colors hover:bg-accent/40 motion-reduce:transition-none"
    >
      {inner}
    </Link>
  )
}
