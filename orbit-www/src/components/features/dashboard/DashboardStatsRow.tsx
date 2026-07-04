import Link from 'next/link'
import { ShieldCheck, ListChecks, Clock, Radio } from 'lucide-react'

interface DashboardStatsRowProps {
  /** Org-wide average compliance score, or `null` when nothing is scored yet. */
  complianceScore: number | null
  scoredCount: number
  entityTotal: number
  openActionItems: number
  pendingApprovals: number
  kafkaTopicCount: number
  virtualClusterCount: number
}

export function DashboardStatsRow({
  complianceScore,
  scoredCount,
  entityTotal,
  openActionItems,
  pendingApprovals,
  kafkaTopicCount,
  virtualClusterCount,
}: DashboardStatsRowProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Compliance"
        icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
        href="/scorecards/reports"
      >
        <StatValue muted={complianceScore === null}>{complianceScore === null ? '—' : complianceScore}</StatValue>
        <StatSub>
          {complianceScore === null ? (
            'No scorecards yet'
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="font-medium tabular-nums text-foreground">{scoredCount}</span>
              <span className="text-muted-foreground">of</span>
              <span className="font-medium tabular-nums text-foreground">{entityTotal}</span>
              <span className="text-muted-foreground">scored</span>
            </span>
          )}
        </StatSub>
      </StatTile>

      <StatTile
        label="Action items"
        icon={<ListChecks className="h-4 w-4 text-muted-foreground" />}
        href="/scorecards/initiatives"
      >
        <StatValue>{openActionItems}</StatValue>
        <StatSub>{openActionItems === 0 ? 'All clear' : 'open to resolve'}</StatSub>
      </StatTile>

      <StatTile
        label="Pending approvals"
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        href="/platform/approvals"
      >
        <StatValue>{pendingApprovals}</StatValue>
        <StatSub>{pendingApprovals === 0 ? 'Nothing waiting' : 'awaiting review'}</StatSub>
      </StatTile>

      <StatTile
        label="Kafka topics"
        icon={<Radio className="h-4 w-4 text-muted-foreground" />}
        href="/platform/kafka"
      >
        <StatValue>{kafkaTopicCount}</StatValue>
        <StatSub>
          <span className="inline-flex items-center gap-1">
            <span className="font-medium tabular-nums text-foreground">{virtualClusterCount}</span>
            <span className="text-muted-foreground">virtual cluster{virtualClusterCount === 1 ? '' : 's'}</span>
          </span>
        </StatSub>
      </StatTile>
    </div>
  )
}

function StatTile({
  label,
  icon,
  href,
  children,
}: {
  label: string
  icon: React.ReactNode
  href: string
  children: React.ReactNode
}) {
  const className =
    'group relative flex min-h-[116px] flex-col gap-1 overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 text-inherit no-underline transition-colors hover:border-foreground/20 hover:bg-muted/30'
  return (
    <Link href={href} className={className}>
      <div className="flex items-center justify-between text-[11.5px] font-medium text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      {children}
    </Link>
  )
}

function StatValue({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={`my-1 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${
        muted ? 'text-muted-foreground' : 'text-foreground'
      }`}
    >
      {children}
    </div>
  )
}

function StatSub({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
      {children}
    </div>
  )
}
