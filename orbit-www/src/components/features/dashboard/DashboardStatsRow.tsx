import Link from 'next/link'
import { Building2, Layers, Radio, FileCode, Plus } from 'lucide-react'

interface DashboardStatsRowProps {
  workspaceCount: number
  workspaceNames?: string[]
  appCount: number
  healthyCount: number
  degradedCount: number
  unknownCount?: number
  kafkaTopicCount: number
  virtualClusterCount: number
  primaryBroker?: string
  apiSchemaCount: number
  publishedApiCount: number
}

export function DashboardStatsRow({
  workspaceCount,
  workspaceNames = [],
  appCount,
  healthyCount,
  degradedCount,
  unknownCount = 0,
  kafkaTopicCount,
  virtualClusterCount,
  primaryBroker,
  apiSchemaCount,
  publishedApiCount,
}: DashboardStatsRowProps) {
  const total = healthyCount + degradedCount + unknownCount || 1
  const pct = (n: number) => `${(n / total) * 100}%`

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Workspaces" icon={<Building2 className="h-4 w-4 text-muted-foreground" />} href="/workspaces">
        <StatValue>{workspaceCount}</StatValue>
        <StatSub>
          {workspaceNames.length > 0 ? workspaceNames.slice(0, 2).join(' · ') : 'No workspaces yet'}
        </StatSub>
      </StatTile>

      <StatTile label="Applications" icon={<Layers className="h-4 w-4 text-muted-foreground" />} href="/apps">
        <StatValue>{appCount}</StatValue>
        {appCount > 0 ? (
          <>
            <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-muted">
              {healthyCount > 0 && <span className="bg-green-500" style={{ width: pct(healthyCount) }} />}
              {degradedCount > 0 && <span className="bg-yellow-500" style={{ width: pct(degradedCount) }} />}
              {unknownCount > 0 && <span className="bg-muted-foreground/50" style={{ width: pct(unknownCount) }} />}
            </div>
            <StatSub>
              {healthyCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="font-medium tabular-nums text-foreground">{healthyCount}</span>
                  <span className="text-muted-foreground">healthy</span>
                </span>
              )}
              {degradedCount > 0 && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    <span className="font-medium tabular-nums text-foreground">{degradedCount}</span>
                    <span className="text-muted-foreground">degraded</span>
                  </span>
                </>
              )}
              {unknownCount > 0 && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                    <span className="font-medium tabular-nums text-foreground">{unknownCount}</span>
                    <span className="text-muted-foreground">unknown</span>
                  </span>
                </>
              )}
            </StatSub>
          </>
        ) : (
          <StatSub>No applications yet</StatSub>
        )}
      </StatTile>

      <StatTile label="Kafka Topics" icon={<Radio className="h-4 w-4 text-muted-foreground" />} href="/platform/kafka">
        <StatValue>{kafkaTopicCount}</StatValue>
        <StatSub>
          <span className="inline-flex items-center gap-1">
            <span className="font-medium tabular-nums text-foreground">{virtualClusterCount}</span>
            <span className="text-muted-foreground">virtual cluster{virtualClusterCount === 1 ? '' : 's'}</span>
          </span>
          {primaryBroker && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="font-mono text-[11px] text-muted-foreground">{primaryBroker}</span>
            </>
          )}
        </StatSub>
      </StatTile>

      {apiSchemaCount === 0 ? (
        <StatTile label="API Schemas" icon={<FileCode className="h-4 w-4 text-muted-foreground" />} href="/catalog/apis" empty>
          <StatValue muted>{apiSchemaCount}</StatValue>
          <Link
            href="/catalog/apis"
            className="mt-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:text-primary/80"
          >
            <Plus className="h-3 w-3" /> Register your first schema
          </Link>
        </StatTile>
      ) : (
        <StatTile label="API Schemas" icon={<FileCode className="h-4 w-4 text-muted-foreground" />} href="/catalog/apis">
          <StatValue>{apiSchemaCount}</StatValue>
          <StatSub>
            <span className="inline-flex items-center gap-1">
              <span className="font-medium tabular-nums text-foreground">{publishedApiCount}</span>
              <span className="text-muted-foreground">published</span>
            </span>
          </StatSub>
        </StatTile>
      )}
    </div>
  )
}

function StatTile({
  label,
  icon,
  href,
  empty,
  children,
}: {
  label: string
  icon: React.ReactNode
  href: string
  empty?: boolean
  children: React.ReactNode
}) {
  const className =
    `group relative flex min-h-[116px] flex-col gap-1 overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 text-inherit no-underline transition-colors hover:border-foreground/20 hover:bg-muted/30 ${
      empty ? 'border-dashed' : ''
    }`
  const inner = (
    <>
      <div className="flex items-center justify-between text-[11.5px] font-medium text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      {children}
    </>
  )
  if (empty) {
    // Empty-state tiles render their own inline CTA link, so the tile itself is a plain container.
    return <div className={className}>{inner}</div>
  }
  return (
    <Link href={href} className={className}>
      {inner}
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
