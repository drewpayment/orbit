# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static `/dashboard` page with a data-rich, personalized dashboard matching the design in `docs/design.pen` frame "Orbit Dashboard - Redesign".

**Architecture:** Server component page fetches user session + parallel aggregate queries across user's workspaces (apps, kafka, APIs, docs), passes pre-fetched data to 6 new presentational components. One lightweight client component for timezone-aware greeting.

**Tech Stack:** Next.js 15 Server Components, Payload CMS queries, React, Tailwind CSS, Lucide icons, date-fns, Vitest + Testing Library

**Design Document:** `docs/plans/2026-02-11-dashboard-redesign-design.md`

---

## Task 1: Create DashboardGreeting Client Component

**Files:**
- Create: `orbit-www/src/components/features/dashboard/DashboardGreeting.tsx`
- Test: `orbit-www/src/components/features/dashboard/DashboardGreeting.test.tsx`

**Step 1: Write the test**

```typescript
// DashboardGreeting.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DashboardGreeting } from './DashboardGreeting'

describe('DashboardGreeting', () => {
  afterEach(() => { cleanup() })

  it('should render morning greeting before noon', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0, 0)) // 9 AM
    render(<DashboardGreeting userName="Drew" />)
    expect(screen.getByText('Good morning, Drew')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render afternoon greeting between noon and 5pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 14, 0, 0)) // 2 PM
    render(<DashboardGreeting userName="Drew" />)
    expect(screen.getByText('Good afternoon, Drew')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render evening greeting after 5pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 20, 0, 0)) // 8 PM
    render(<DashboardGreeting userName="Drew" />)
    expect(screen.getByText('Good evening, Drew')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render fallback when no userName provided', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0, 0))
    render(<DashboardGreeting userName="" />)
    expect(screen.getByText('Good morning')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardGreeting.test.tsx`
Expected: FAIL — module not found

**Step 3: Write the component**

```typescript
// DashboardGreeting.tsx
'use client'

import { useState, useEffect } from 'react'

interface DashboardGreetingProps {
  userName: string
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardGreeting({ userName }: DashboardGreetingProps) {
  const [greeting, setGreeting] = useState('Welcome')

  useEffect(() => {
    setGreeting(getGreeting())
  }, [])

  const displayText = userName ? `${greeting}, ${userName}` : greeting

  return (
    <h1 className="text-2xl font-bold tracking-tight text-foreground">
      {displayText}
    </h1>
  )
}
```

**Note:** Uses `useEffect` to avoid hydration mismatch since server and client may have different times. Initial render shows "Welcome" which updates on mount.

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardGreeting.test.tsx`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/dashboard/DashboardGreeting.tsx orbit-www/src/components/features/dashboard/DashboardGreeting.test.tsx
git commit -m "feat(dashboard): add DashboardGreeting client component with time-of-day logic"
```

---

## Task 2: Create DashboardStatsRow Component

**Files:**
- Create: `orbit-www/src/components/features/dashboard/DashboardStatsRow.tsx`
- Test: `orbit-www/src/components/features/dashboard/DashboardStatsRow.test.tsx`

**Step 1: Write the test**

```typescript
// DashboardStatsRow.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardStatsRow } from './DashboardStatsRow'

describe('DashboardStatsRow', () => {
  afterEach(() => { cleanup() })

  const defaultProps = {
    workspaceCount: 6,
    appCount: 23,
    healthyCount: 19,
    degradedCount: 4,
    kafkaTopicCount: 47,
    virtualClusterCount: 8,
    apiSchemaCount: 12,
    publishedApiCount: 9,
  }

  it('should render all four stat cards', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('Applications')).toBeInTheDocument()
    expect(screen.getByText('Kafka Topics')).toBeInTheDocument()
    expect(screen.getByText('API Schemas')).toBeInTheDocument()
  })

  it('should render stat values', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('should render health breakdown for apps', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('19 healthy')).toBeInTheDocument()
    expect(screen.getByText('4 degraded')).toBeInTheDocument()
  })

  it('should render virtual cluster count', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('8 virtual clusters')).toBeInTheDocument()
  })

  it('should render published API count', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('9 published')).toBeInTheDocument()
  })

  it('should handle zero counts gracefully', () => {
    render(<DashboardStatsRow {...defaultProps} workspaceCount={0} appCount={0} kafkaTopicCount={0} apiSchemaCount={0} />)
    const zeros = screen.getAllByText('0')
    expect(zeros).toHaveLength(4)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardStatsRow.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```typescript
// DashboardStatsRow.tsx
import { Card, CardContent } from '@/components/ui/card'
import { Building2, Layers, Radio, FileCode, Server, TrendingUp } from 'lucide-react'

interface DashboardStatsRowProps {
  workspaceCount: number
  appCount: number
  healthyCount: number
  degradedCount: number
  kafkaTopicCount: number
  virtualClusterCount: number
  apiSchemaCount: number
  publishedApiCount: number
}

export function DashboardStatsRow({
  workspaceCount,
  appCount,
  healthyCount,
  degradedCount,
  kafkaTopicCount,
  virtualClusterCount,
  apiSchemaCount,
  publishedApiCount,
}: DashboardStatsRowProps) {
  const stats = [
    {
      label: 'Workspaces',
      value: workspaceCount,
      icon: Building2,
      subtitle: null,
    },
    {
      label: 'Applications',
      value: appCount,
      icon: Layers,
      subtitle: (
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium text-green-500">{healthyCount} healthy</span>
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-yellow-500">{degradedCount} degraded</span>
        </div>
      ),
    },
    {
      label: 'Kafka Topics',
      value: kafkaTopicCount,
      icon: Radio,
      subtitle: (
        <div className="flex items-center gap-1">
          <Server className="h-3 w-3 text-blue-500" />
          <span className="text-xs font-medium text-blue-500">{virtualClusterCount} virtual clusters</span>
        </div>
      ),
    },
    {
      label: 'API Schemas',
      value: apiSchemaCount,
      icon: FileCode,
      subtitle: (
        <div className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span className="text-xs font-medium text-green-500">{publishedApiCount} published</span>
        </div>
      ),
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold text-foreground">{stat.value}</div>
            {stat.subtitle && <div className="mt-2">{stat.subtitle}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardStatsRow.test.tsx`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/dashboard/DashboardStatsRow.tsx orbit-www/src/components/features/dashboard/DashboardStatsRow.test.tsx
git commit -m "feat(dashboard): add DashboardStatsRow with platform metrics"
```

---

## Task 3: Create DashboardWorkspacesCard Component

**Files:**
- Create: `orbit-www/src/components/features/dashboard/DashboardWorkspacesCard.tsx`
- Test: `orbit-www/src/components/features/dashboard/DashboardWorkspacesCard.test.tsx`

**Step 1: Write the test**

```typescript
// DashboardWorkspacesCard.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardWorkspacesCard } from './DashboardWorkspacesCard'

describe('DashboardWorkspacesCard', () => {
  afterEach(() => { cleanup() })

  const mockMemberships = [
    {
      id: '1',
      role: 'owner',
      workspace: { id: 'ws1', name: 'Engineering', slug: 'engineering' },
      user: { id: 'u1' },
    },
    {
      id: '2',
      role: 'admin',
      workspace: { id: 'ws2', name: 'Digital', slug: 'digital' },
      user: { id: 'u1' },
    },
    {
      id: '3',
      role: 'member',
      workspace: { id: 'ws3', name: "Alice's Workspace", slug: 'dev1-workspace' },
      user: { id: 'u1' },
    },
  ] as any[]

  it('should render card title', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('My Workspaces')).toBeInTheDocument()
  })

  it('should render workspace names', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Digital')).toBeInTheDocument()
    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument()
  })

  it('should render role badges', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('member')).toBeInTheDocument()
  })

  it('should render workspace links', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    const links = screen.getAllByRole('link')
    const wsLinks = links.filter(l => l.getAttribute('href')?.startsWith('/workspaces/'))
    expect(wsLinks).toHaveLength(3)
  })

  it('should render empty state when no memberships', () => {
    render(<DashboardWorkspacesCard memberships={[]} />)
    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument()
  })

  it('should render View all link', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText(/view all/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardWorkspacesCard.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```typescript
// DashboardWorkspacesCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2 } from 'lucide-react'
import Link from 'next/link'
import type { WorkspaceMember } from '@/payload-types'

interface DashboardWorkspacesCardProps {
  memberships: WorkspaceMember[]
}

const roleColors: Record<string, { bg: string; text: string }> = {
  owner: { bg: 'bg-green-500/10', text: 'text-green-500' },
  admin: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  member: { bg: 'bg-secondary', text: 'text-muted-foreground' },
}

const avatarColors = [
  'bg-blue-500/20 text-blue-500',
  'bg-purple-500/20 text-purple-500',
  'bg-orange-500/20 text-orange-500',
  'bg-green-500/20 text-green-500',
  'bg-red-500/20 text-red-500',
  'bg-yellow-500/20 text-yellow-500',
]

export function DashboardWorkspacesCard({ memberships }: DashboardWorkspacesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-base font-semibold">My Workspaces</CardTitle>
            <p className="text-xs text-muted-foreground">Workspaces you belong to</p>
          </div>
          {memberships.length > 0 && (
            <Link href="/workspaces" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {memberships.length === 0 ? (
          <div className="text-center py-6">
            <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No workspaces yet</p>
            <Link href="/workspaces" className="text-xs text-primary hover:underline mt-1 inline-block">
              Browse workspaces
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {memberships.map((membership, index) => {
              const ws = typeof membership.workspace === 'object' ? membership.workspace : null
              if (!ws) return null
              const role = membership.role || 'member'
              const colors = roleColors[role] || roleColors.member
              const avatarColor = avatarColors[index % avatarColors.length]
              return (
                <Link
                  key={membership.id}
                  href={`/workspaces/${ws.slug}`}
                  className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold ${avatarColor}`}>
                    {ws.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ws.name}</p>
                    <p className="text-xs text-muted-foreground">/{ws.slug}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                    {role}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardWorkspacesCard.test.tsx`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/dashboard/DashboardWorkspacesCard.tsx orbit-www/src/components/features/dashboard/DashboardWorkspacesCard.test.tsx
git commit -m "feat(dashboard): add DashboardWorkspacesCard with role badges"
```

---

## Task 4: Create DashboardAppHealthCard Component

**Files:**
- Create: `orbit-www/src/components/features/dashboard/DashboardAppHealthCard.tsx`
- Test: `orbit-www/src/components/features/dashboard/DashboardAppHealthCard.test.tsx`

**Step 1: Write the test**

```typescript
// DashboardAppHealthCard.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardAppHealthCard } from './DashboardAppHealthCard'

describe('DashboardAppHealthCard', () => {
  afterEach(() => { cleanup() })

  const mockApps = [
    {
      id: '1',
      name: 'payment-service',
      status: 'healthy',
      workspace: { id: 'ws1', name: 'Engineering', slug: 'engineering' },
      latestBuild: { version: 'v2.4.1' },
    },
    {
      id: '2',
      name: 'user-auth-api',
      status: 'degraded',
      workspace: { id: 'ws2', name: 'Digital', slug: 'digital' },
      latestBuild: { version: 'v1.8.0' },
    },
    {
      id: '3',
      name: 'order-processor',
      status: 'healthy',
      workspace: { id: 'ws1', name: 'Engineering', slug: 'engineering' },
      latestBuild: { version: 'v3.1.2' },
    },
  ] as any[]

  it('should render card title', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getByText('Application Health')).toBeInTheDocument()
  })

  it('should render app names', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getByText('payment-service')).toBeInTheDocument()
    expect(screen.getByText('user-auth-api')).toBeInTheDocument()
    expect(screen.getByText('order-processor')).toBeInTheDocument()
  })

  it('should render health status badges', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    const healthyBadges = screen.getAllByText('healthy')
    expect(healthyBadges).toHaveLength(2)
    expect(screen.getByText('degraded')).toBeInTheDocument()
  })

  it('should render empty state when no apps', () => {
    render(<DashboardAppHealthCard apps={[]} />)
    expect(screen.getByText(/no applications/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAppHealthCard.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```typescript
// DashboardAppHealthCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Layers } from 'lucide-react'
import Link from 'next/link'
import type { App } from '@/payload-types'

interface DashboardAppHealthCardProps {
  apps: App[]
}

const statusConfig: Record<string, { dotColor: string; badgeBg: string; badgeText: string; label: string }> = {
  healthy: { dotColor: 'bg-green-500', badgeBg: 'bg-green-500/10', badgeText: 'text-green-500', label: 'healthy' },
  degraded: { dotColor: 'bg-yellow-500', badgeBg: 'bg-yellow-500/10', badgeText: 'text-yellow-500', label: 'degraded' },
  down: { dotColor: 'bg-red-500', badgeBg: 'bg-red-500/10', badgeText: 'text-red-500', label: 'down' },
  unknown: { dotColor: 'bg-gray-500', badgeBg: 'bg-secondary', badgeText: 'text-muted-foreground', label: 'unknown' },
}

export function DashboardAppHealthCard({ apps }: DashboardAppHealthCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-base font-semibold">Application Health</CardTitle>
            <p className="text-xs text-muted-foreground">Across all workspaces</p>
          </div>
          {apps.length > 0 && (
            <Link href="/apps" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {apps.length === 0 ? (
          <div className="text-center py-6">
            <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No applications yet</p>
            <Link href="/apps/new" className="text-xs text-primary hover:underline mt-1 inline-block">
              Create your first app
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {apps.map((app) => {
              const status = app.status || 'unknown'
              const config = statusConfig[status] || statusConfig.unknown
              const ws = typeof app.workspace === 'object' ? app.workspace : null
              const version = app.latestBuild && typeof app.latestBuild === 'object'
                ? (app.latestBuild as any).version || ''
                : ''
              return (
                <div
                  key={app.id}
                  className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${config.dotColor} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{app.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ws?.name}{version ? ` · ${version}` : ''}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${config.badgeBg} ${config.badgeText}`}>
                    {config.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardAppHealthCard.test.tsx`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/dashboard/DashboardAppHealthCard.tsx orbit-www/src/components/features/dashboard/DashboardAppHealthCard.test.tsx
git commit -m "feat(dashboard): add DashboardAppHealthCard with status indicators"
```

---

## Task 5: Create DashboardActivityFeed Component

**Files:**
- Create: `orbit-www/src/components/features/dashboard/DashboardActivityFeed.tsx`
- Test: `orbit-www/src/components/features/dashboard/DashboardActivityFeed.test.tsx`

**Step 1: Write the test**

```typescript
// DashboardActivityFeed.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardActivityFeed } from './DashboardActivityFeed'
import type { Activity } from './DashboardActivityFeed'

describe('DashboardActivityFeed', () => {
  afterEach(() => { cleanup() })

  const mockActivities: Activity[] = [
    { type: 'app', title: 'App deployed', description: 'payment-service v2.4.1 deployed', timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
    { type: 'topic', title: 'Topic created', description: 'orders.completed in Engineering cluster', timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
    { type: 'schema', title: 'Schema registered', description: 'user-events-v3.avsc added', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    { type: 'doc', title: 'Doc updated', description: 'Kafka troubleshooting guide revised', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  ]

  it('should render card title', () => {
    render(<DashboardActivityFeed activities={mockActivities} />)
    expect(screen.getByText('Recent Activity')).toBeInTheDocument()
  })

  it('should render activity titles', () => {
    render(<DashboardActivityFeed activities={mockActivities} />)
    expect(screen.getByText('App deployed')).toBeInTheDocument()
    expect(screen.getByText('Topic created')).toBeInTheDocument()
    expect(screen.getByText('Schema registered')).toBeInTheDocument()
    expect(screen.getByText('Doc updated')).toBeInTheDocument()
  })

  it('should render activity descriptions', () => {
    render(<DashboardActivityFeed activities={mockActivities} />)
    expect(screen.getByText('payment-service v2.4.1 deployed')).toBeInTheDocument()
  })

  it('should render empty state when no activities', () => {
    render(<DashboardActivityFeed activities={[]} />)
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardActivityFeed.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```typescript
// DashboardActivityFeed.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Activity as ActivityIcon } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export interface Activity {
  type: 'app' | 'topic' | 'schema' | 'doc'
  title: string
  description: string
  timestamp: string
}

interface DashboardActivityFeedProps {
  activities: Activity[]
}

const typeColors: Record<Activity['type'], string> = {
  app: 'bg-green-500',
  topic: 'bg-blue-500',
  schema: 'bg-purple-500',
  doc: 'bg-green-500',
}

export function DashboardActivityFeed({ activities }: DashboardActivityFeedProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {activities.length === 0 ? (
          <div className="text-center py-6">
            <ActivityIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-1">
            {activities.map((activity, index) => (
              <div
                key={`${activity.type}-${index}`}
                className="flex gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full ${typeColors[activity.type]} shrink-0`} />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{activity.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{activity.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardActivityFeed.test.tsx`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/dashboard/DashboardActivityFeed.tsx orbit-www/src/components/features/dashboard/DashboardActivityFeed.test.tsx
git commit -m "feat(dashboard): add DashboardActivityFeed with synthesized timeline"
```

---

## Task 6: Create DashboardQuickActions Component

**Files:**
- Create: `orbit-www/src/components/features/dashboard/DashboardQuickActions.tsx`
- Test: `orbit-www/src/components/features/dashboard/DashboardQuickActions.test.tsx`

**Step 1: Write the test**

```typescript
// DashboardQuickActions.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardQuickActions } from './DashboardQuickActions'

describe('DashboardQuickActions', () => {
  afterEach(() => { cleanup() })

  it('should render card title', () => {
    render(<DashboardQuickActions />)
    expect(screen.getByText('Quick Actions')).toBeInTheDocument()
  })

  it('should render all 5 action items', () => {
    render(<DashboardQuickActions />)
    expect(screen.getByText('Create Application')).toBeInTheDocument()
    expect(screen.getByText('Request Kafka Topic')).toBeInTheDocument()
    expect(screen.getByText('Register API Schema')).toBeInTheDocument()
    expect(screen.getByText('Write Documentation')).toBeInTheDocument()
    expect(screen.getByText('Use Template')).toBeInTheDocument()
  })

  it('should render links for each action', () => {
    render(<DashboardQuickActions />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(5)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardQuickActions.test.tsx`
Expected: FAIL

**Step 3: Write the component**

```typescript
// DashboardQuickActions.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CirclePlus, Radio, FileCode, BookOpen, LayoutTemplate } from 'lucide-react'
import Link from 'next/link'

const actions = [
  {
    label: 'Create Application',
    href: '/apps/new',
    icon: CirclePlus,
    iconBg: 'bg-orange-500/10',
    iconColor: 'text-orange-500',
  },
  {
    label: 'Request Kafka Topic',
    href: '/workspaces',
    icon: Radio,
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-500',
  },
  {
    label: 'Register API Schema',
    href: '/catalog/apis',
    icon: FileCode,
    iconBg: 'bg-green-500/10',
    iconColor: 'text-green-500',
  },
  {
    label: 'Write Documentation',
    href: '/workspaces',
    icon: BookOpen,
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-500',
  },
  {
    label: 'Use Template',
    href: '/templates',
    icon: LayoutTemplate,
    iconBg: 'bg-yellow-500/10',
    iconColor: 'text-yellow-500',
  },
]

export function DashboardQuickActions() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1">
          {actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${action.iconBg}`}>
                <action.icon className={`h-4 w-4 ${action.iconColor}`} />
              </div>
              <span className="text-sm font-medium">{action.label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/DashboardQuickActions.test.tsx`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/dashboard/DashboardQuickActions.tsx orbit-www/src/components/features/dashboard/DashboardQuickActions.test.tsx
git commit -m "feat(dashboard): add DashboardQuickActions with color-coded shortcuts"
```

---

## Task 7: Create Barrel Export File

**Files:**
- Create: `orbit-www/src/components/features/dashboard/index.ts`

**Step 1: Create the barrel file**

```typescript
// index.ts
export { DashboardGreeting } from './DashboardGreeting'
export { DashboardStatsRow } from './DashboardStatsRow'
export { DashboardWorkspacesCard } from './DashboardWorkspacesCard'
export { DashboardAppHealthCard } from './DashboardAppHealthCard'
export { DashboardActivityFeed } from './DashboardActivityFeed'
export type { Activity } from './DashboardActivityFeed'
export { DashboardQuickActions } from './DashboardQuickActions'
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/dashboard/index.ts
git commit -m "feat(dashboard): add barrel export for dashboard components"
```

---

## Task 8: Rewrite Dashboard Page with Data Fetching + Layout

**Files:**
- Modify: `orbit-www/src/app/(frontend)/dashboard/page.tsx` (full rewrite)

This is the main integration task. The page fetches all data server-side and assembles the layout.

**Step 1: Rewrite the page**

```typescript
// page.tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Plus, LayoutTemplate } from 'lucide-react'
import { getPayloadClient, getSession, getUserWorkspaceMemberships } from '@/lib/data/cached-queries'
import {
  DashboardGreeting,
  DashboardStatsRow,
  DashboardWorkspacesCard,
  DashboardAppHealthCard,
  DashboardActivityFeed,
  DashboardQuickActions,
} from '@/components/features/dashboard'
import type { Activity } from '@/components/features/dashboard'

export default async function DashboardPage() {
  // Phase 1: Get payload client + user session
  const [payload, session] = await Promise.all([
    getPayloadClient(),
    getSession(),
  ])

  // Phase 2: Get user's workspace memberships
  const memberships = session?.user
    ? await getUserWorkspaceMemberships(session.user.id)
    : []

  const workspaceIds = memberships
    .map((m) => (typeof m.workspace === 'object' ? m.workspace?.id : m.workspace))
    .filter((id): id is string => !!id)

  // Phase 3: Parallel aggregate queries across user's workspaces
  const hasWorkspaces = workspaceIds.length > 0
  const workspaceFilter = { workspace: { in: workspaceIds } }

  const [
    appsResult,
    kafkaTopicCount,
    virtualClusterCount,
    apiSchemaCount,
    publishedApiCount,
    recentTopics,
    recentSchemas,
    knowledgeSpacesResult,
  ] = hasWorkspaces
    ? await Promise.all([
        // Apps with status (used for stats + health card + activity)
        payload.find({
          collection: 'apps',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 10,
          depth: 1,
        }),
        // Kafka topic count
        payload.count({
          collection: 'kafka-topics',
          where: workspaceFilter,
          overrideAccess: true,
        }),
        // Virtual cluster count
        payload.count({
          collection: 'kafka-virtual-clusters',
          where: workspaceFilter,
          overrideAccess: true,
        }),
        // API schema count
        payload.count({
          collection: 'api-schemas',
          where: workspaceFilter,
        }),
        // Published API schema count
        payload.count({
          collection: 'api-schemas',
          where: { ...workspaceFilter, status: { equals: 'published' } },
        }),
        // Recent Kafka topics (for activity)
        payload.find({
          collection: 'kafka-topics',
          where: workspaceFilter,
          sort: '-createdAt',
          limit: 3,
          depth: 1,
          overrideAccess: true,
        }),
        // Recent API schemas (for activity)
        payload.find({
          collection: 'api-schemas',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 3,
          depth: 1,
        }),
        // Knowledge spaces (to get space IDs for recent docs)
        payload.find({
          collection: 'knowledge-spaces',
          where: workspaceFilter,
          limit: 100,
        }),
      ])
    : [
        { docs: [], totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { docs: [] },
        { docs: [] },
        { docs: [] },
      ]

  // Phase 4: Recent docs (depends on knowledge spaces)
  const spaceIds = Array.isArray(knowledgeSpacesResult)
    ? []
    : 'docs' in knowledgeSpacesResult
      ? knowledgeSpacesResult.docs.map((s) => s.id)
      : []

  const recentDocs = spaceIds.length > 0
    ? await payload.find({
        collection: 'knowledge-pages',
        where: { knowledgeSpace: { in: spaceIds } },
        sort: '-updatedAt',
        limit: 3,
        depth: 1,
      })
    : { docs: [] }

  // Compute stats
  const apps = 'docs' in appsResult ? appsResult.docs : []
  const appCount = 'totalDocs' in appsResult ? appsResult.totalDocs : 0
  const healthyCount = apps.filter((a) => a.status === 'healthy').length
  const degradedCount = apps.filter((a) => a.status === 'degraded' || a.status === 'down').length

  // Build activity feed from recent items
  const activities: Activity[] = []

  // App activities
  for (const app of apps.slice(0, 3)) {
    activities.push({
      type: 'app',
      title: app.status === 'healthy' ? 'App deployed' : 'App status changed',
      description: `${app.name} in ${typeof app.workspace === 'object' ? app.workspace?.name : 'workspace'}`,
      timestamp: app.updatedAt,
    })
  }

  // Kafka topic activities
  const topics = 'docs' in recentTopics ? recentTopics.docs : []
  for (const topic of topics) {
    activities.push({
      type: 'topic',
      title: 'Topic created',
      description: `${topic.name}`,
      timestamp: topic.createdAt,
    })
  }

  // Schema activities
  const schemas = 'docs' in recentSchemas ? recentSchemas.docs : []
  for (const schema of schemas) {
    activities.push({
      type: 'schema',
      title: schema.status === 'published' ? 'API published' : 'Schema registered',
      description: schema.name,
      timestamp: schema.updatedAt,
    })
  }

  // Doc activities
  const docs = 'docs' in recentDocs ? recentDocs.docs : []
  for (const doc of docs) {
    activities.push({
      type: 'doc',
      title: 'Doc updated',
      description: doc.title,
      timestamp: doc.updatedAt,
    })
  }

  // Sort by timestamp descending, take top 5
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const topActivities = activities.slice(0, 5)

  const userName = session?.user?.name?.split(' ')[0] || ''

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-7 p-8 stagger-reveal">
          {/* Welcome Section */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between stagger-item">
            <div className="space-y-1">
              <DashboardGreeting userName={userName} />
              <p className="text-sm text-muted-foreground">
                Here&apos;s what&apos;s happening across your workspaces
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" asChild>
                <Link href="/admin/workspaces">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Workspace
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/templates">
                  <LayoutTemplate className="mr-1.5 h-4 w-4" />
                  Browse Templates
                </Link>
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="stagger-item">
            <DashboardStatsRow
              workspaceCount={workspaceIds.length}
              appCount={appCount}
              healthyCount={healthyCount}
              degradedCount={degradedCount}
              kafkaTopicCount={kafkaTopicCount.totalDocs}
              virtualClusterCount={virtualClusterCount.totalDocs}
              apiSchemaCount={apiSchemaCount.totalDocs}
              publishedApiCount={publishedApiCount.totalDocs}
            />
          </div>

          {/* Two-Column Layout */}
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            {/* Left Column */}
            <div className="space-y-5 stagger-item">
              <DashboardWorkspacesCard memberships={memberships} />
              <DashboardAppHealthCard apps={apps.slice(0, 5)} />
            </div>

            {/* Right Column */}
            <div className="space-y-5 stagger-item">
              <DashboardActivityFeed activities={topActivities} />
              <DashboardQuickActions />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit --pretty 2>&1 | head -50`
Expected: No errors related to dashboard files (existing errors elsewhere are OK)

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/dashboard/page.tsx
git commit -m "feat(dashboard): rewrite page with data-rich personalized layout"
```

---

## Task 9: Manual Visual Verification

**Step 1: Start dev server (if not running)**

Run: `cd orbit-www && bun run dev`

**Step 2: Open in browser**

Navigate to `http://localhost:3000/dashboard`

**Verify checklist:**
- [ ] Personalized greeting shows with user's first name
- [ ] Time-of-day greeting changes (morning/afternoon/evening)
- [ ] Stats row shows 4 cards with correct counts
- [ ] My Workspaces card shows user's workspaces with role badges
- [ ] Application Health card shows apps with status dots and badges
- [ ] Recent Activity feed shows merged events sorted by time
- [ ] Quick Actions shows all 5 items with correct icons/colors
- [ ] Responsive: two-column collapses to single column on smaller screens
- [ ] Stagger animation plays on page load
- [ ] Empty states render correctly when data is missing
- [ ] Links navigate to correct pages

**Step 3: Commit any fixes needed from visual verification**

---

## Task 10: Run All Tests

**Step 1: Run dashboard component tests**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/dashboard/`
Expected: All tests pass (23+ tests across 6 files)

**Step 2: Run full frontend test suite**

Run: `cd orbit-www && pnpm exec vitest run`
Expected: No regressions

**Step 3: Run linter**

Run: `cd orbit-www && pnpm exec next lint`
Expected: No new lint errors in dashboard files

**Step 4: Final commit if any fixes needed**
